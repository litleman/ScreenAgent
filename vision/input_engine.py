"""
Screen Agent — Input Engine v2
Multi-backend hardware input simulation with human-like movement,
click verification, coordinate calibration, and automatic fallback.

Input: URI-encoded JSON of action data
Output: JSON { success, backend, method, error?, calibrated? }
"""

import json
import sys
import time
import os
import math
import random
import struct
from enum import Enum
from typing import Optional
from urllib.parse import unquote
from dataclasses import dataclass, asdict
from pathlib import Path

# =========================================================================
#  Constants
# =========================================================================

SCREENSHOT_DIR = Path(__file__).resolve().parent.parent / 'screenshots'
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

BACKEND_ORDER = ['sendinput', 'pyautogui']

class InputBackend(str, Enum):
    SENDINPUT = 'sendinput'
    PYAUTOGUI = 'pyautogui'
    DIRECTINPUT = 'directinput'

class ActionType(str, Enum):
    CLICK = 'click'
    DOUBLE_CLICK = 'doubleClick'
    RIGHT_CLICK = 'rightClick'
    TYPE = 'type'
    KEY_PRESS = 'keyPress'
    HOVER = 'hover'
    SCROLL = 'scroll'
    DRAG = 'drag'

class ErrorCategory(str, Enum):
    PERMISSION = 'permission'
    COORDINATE = 'coordinate'
    TIMEOUT = 'timeout'
    BACKEND = 'backend'
    UNKNOWN = 'unknown'

# =========================================================================
#  Data classes
# =========================================================================

@dataclass
class Point:
    x: int
    y: int

@dataclass
class CalibratedCoord:
    raw: Point
    calibrated: Point
    dpi_scale: float
    monitor_index: int

@dataclass
class MovementProfile:
    style: str = 'bezier'
    speed: str = 'medium'
    overshoot_chance: float = 0.15
    jitter_amount: int = 2
    control_point_spread: float = 0.3

    @classmethod
    def from_dict(cls, d: dict) -> 'MovementProfile':
        return cls(
            style=d.get('style', 'bezier'),
            speed=d.get('speed', 'medium'),
            overshoot_chance=d.get('overshootChance', 0.15),
            jitter_amount=d.get('jitterAmount', 2),
            control_point_spread=d.get('controlPointSpread', 0.3),
        )

@dataclass
class ClickVerification:
    verified: bool = False
    method: str = 'none'
    confidence: float = 0.0
    details: Optional[list] = None

# =========================================================================
#  Coordinate calibration (multi-monitor, high-DPI)
# =========================================================================

def get_monitor_info():
    monitors = []
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32

        dpi_scale = 1.0
        try:
            shcore = ctypes.windll.shcore
            monitor = user32.MonitorFromPoint(ctypes.c_long(0), ctypes.c_long(0), ctypes.c_long(0))
            dpi_x = ctypes.c_uint()
            dpi_y = ctypes.c_uint()
            if shcore.GetDpiForMonitor(monitor, 0, ctypes.byref(dpi_x), ctypes.byref(dpi_y)) == 0:
                dpi_scale = dpi_x.value / 96.0
        except Exception:
            pass

        virtual_w = user32.GetSystemMetrics(78)
        virtual_h = user32.GetSystemMetrics(79)
        monitors.append({
            'index': 0,
            'bounds': {'x': 0, 'y': 0, 'width': virtual_w, 'height': virtual_h},
            'dpi_scale': dpi_scale,
            'is_primary': True,
        })
    except Exception:
        monitors.append({
            'index': 0,
            'bounds': {'x': 0, 'y': 0, 'width': 1920, 'height': 1080},
            'dpi_scale': 1.0,
            'is_primary': True,
        })
    return monitors

def calibrate_coord(x: int, y: int, monitors: list) -> CalibratedCoord:
    if not monitors:
        return CalibratedCoord(
            raw=Point(x, y), calibrated=Point(x, y),
            dpi_scale=1.0, monitor_index=0,
        )

    for m in monitors:
        b = m['bounds']
        if b['x'] <= x < b['x'] + b['width'] and b['y'] <= y < b['y'] + b['height']:
            cal_x = int(x / m['dpi_scale'])
            cal_y = int(y / m['dpi_scale'])
            return CalibratedCoord(
                raw=Point(x, y), calibrated=Point(cal_x, cal_y),
                dpi_scale=m['dpi_scale'], monitor_index=m['index'],
            )

    primary = monitors[0]
    cal_x = int(x / primary['dpi_scale'])
    cal_y = int(y / primary['dpi_scale'])
    return CalibratedCoord(
        raw=Point(x, y), calibrated=Point(cal_x, cal_y),
        dpi_scale=primary['dpi_scale'], monitor_index=primary['index'],
    )

def validate_coord(x, y) -> Optional[str]:
    if x is None or y is None:
        return '需要坐标 (x, y)'
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return f'坐标类型无效: ({type(x).__name__}, {type(y).__name__})'
    if math.isnan(x) or math.isnan(y):
        return f'坐标为 NaN: ({x}, {y})'
    if x < -32768 or y < -32768 or x > 32768 or y > 32768:
        return f'坐标超出32位范围: ({x}, {y})'
    return None

# =========================================================================
#  Bezier curve mouse path planning
# =========================================================================

SPEED_RANGES = {
    'slow': (300, 600),
    'medium': (120, 250),
    'human': (100, 350),
    'fast': (50, 100),
    'instant': (0, 0),
}

def bezier_point(p0, p1, p2, p3, t):
    u = 1 - t
    return (
        u ** 3 * p0[0] + 3 * u ** 2 * t * p1[0] + 3 * u * t ** 2 * p2[0] + t ** 3 * p3[0],
        u ** 3 * p0[1] + 3 * u ** 2 * t * p1[1] + 3 * u * t ** 2 * p2[1] + t ** 3 * p3[1],
    )

def generate_bezier_path(
    start_x, start_y, end_x, end_y,
    spread=0.3,
    num_points=None,
) -> list:
    dx = end_x - start_x
    dy = end_y - start_y
    dist = math.sqrt(dx * dx + dy * dy)

    if num_points is None:
        num_points = max(8, min(int(dist / 8), 40))

    if num_points < 3:
        return [Point(int(start_x + dx * t), int(start_y + dy * t))
                for t in [i / 2 for i in range(3)]]

    offset = dist * spread * 0.15
    cp1 = (
        start_x + dx * 0.25 + random.uniform(-offset, offset),
        start_y + dy * 0.25 + random.uniform(-offset, offset),
    )
    cp2 = (
        start_x + dx * 0.75 + random.uniform(-offset, offset),
        start_y + dy * 0.75 + random.uniform(-offset, offset),
    )

    if abs(dy) > abs(dx) * 0.3:
        perp_offset = offset * 0.3
        cp1 = (cp1[0] + random.uniform(-perp_offset, perp_offset), cp1[1])
        cp2 = (cp2[0] + random.uniform(-perp_offset, perp_offset), cp2[1])

    path = []
    for i in range(num_points):
        t = i / (num_points - 1)
        px, py = bezier_point(
            (start_x, start_y), cp1, cp2, (end_x, end_y), t,
        )
        path.append(Point(int(px), int(py)))

    path[-1] = Point(end_x, end_y)
    return path

def apply_velocity_profile(
    path: list, speed_range: tuple,
) -> list:
    if not path or len(path) < 2:
        return path
    min_ms, max_ms = speed_range
    if min_ms == 0 and max_ms == 0:
        return path

    total_time = random.uniform(min_ms, max_ms) / 1000.0
    n = len(path)

    timestamps = []
    for i in range(n):
        progress = i / (n - 1)
        velocity = math.sin(progress * math.pi)
        timestamps.append(velocity)

    total_weight = sum(timestamps)
    if total_weight <= 0:
        return path

    intervals = [t / total_weight * total_time for t in timestamps]
    cumulative = 0.0
    result = []
    for i, pt in enumerate(path):
        cumulative += intervals[i]
        result.append(pt)

    return result

def add_overshoot(path: list, chance: float) -> list:
    if random.random() >= chance or len(path) < 4:
        return path

    last = path[-1]
    second_last = path[-2]
    overshoot_amt = min(15, max(3, int(math.hypot(last.x - second_last.x, last.y - second_last.y) * 0.15)))

    dx = last.x - second_last.x
    dy = last.y - second_last.y
    length = math.hypot(dx, dy)
    if length < 1:
        return path

    overshoot_target = Point(
        last.x + int(dx / length * overshoot_amt),
        last.y + int(dy / length * overshoot_amt),
    )
    correction = Point(
        last.x + random.randint(-2, 2),
        last.y + random.randint(-2, 2),
    )
    path.append(overshoot_target)
    path.append(correction)
    return path

def add_jitter(path: list, amount: int) -> list:
    if amount <= 0 or len(path) < 3:
        return path
    jittered = [path[0]]
    for pt in path[1:-1]:
        jittered.append(Point(
            pt.x + random.randint(-amount, amount),
            pt.y + random.randint(-amount, amount),
        ))
    jittered.append(path[-1])
    return jittered

def plan_mouse_path(
    start_x, start_y, end_x, end_y,
    profile: MovementProfile,
    current_x=None, current_y=None,
) -> list:
    sx = current_x if current_x is not None else start_x
    sy = current_y if current_y is not None else start_y

    if profile.style == 'direct':
        return [Point(sx, sy), Point(end_x, end_y)]

    if profile.style in ('bezier', 'human'):
        path = generate_bezier_path(sx, sy, end_x, end_y, profile.control_point_spread)
        path = add_overshoot(path, profile.overshoot_chance)
        path = add_jitter(path, profile.jitter_amount)
        speed_range = SPEED_RANGES.get(profile.speed, SPEED_RANGES['medium'])
        path = apply_velocity_profile(path, speed_range)
        return path

    return [Point(sx, sy), Point(end_x, end_y)]

# =========================================================================
#  Click verification — screenshot diff & color change
# =========================================================================

def take_region_screenshot(x, y, width=40, height=40):
    try:
        from PIL import ImageGrab
        left = max(0, x - width // 2)
        top = max(0, y - height // 2)
        im = ImageGrab.grab(bbox=(left, top, left + width, top + height))
        ts = int(time.time() * 1000000)
        path = str(SCREENSHOT_DIR / f'click_vfy_{ts}.png')
        im.save(path, 'PNG')
        return path, im
    except Exception:
        return None, None

def verify_click_screenshot_diff(pre_image, post_image, threshold=30) -> dict:
    if pre_image is None or post_image is None:
        return {'verified': False, 'confidence': 0.0, 'method': 'none', 'details': ['截图失败']}

    try:
        import numpy as np
        pre_arr = np.array(pre_image.convert('L'), dtype=np.int16)
        post_arr = np.array(post_image.convert('L'), dtype=np.int16)
        diff = np.abs(post_arr - pre_arr)
        changed_pixels = int(np.sum(diff > threshold))
        total_pixels = diff.size
        change_ratio = changed_pixels / max(total_pixels, 1)

        return {
            'verified': change_ratio > 0.02,
            'confidence': min(change_ratio * 10, 1.0),
            'method': 'screenshot_diff',
            'details': [
                f'变化像素: {changed_pixels}/{total_pixels} ({change_ratio*100:.1f}%)',
            ],
        }
    except Exception as e:
        return {'verified': False, 'confidence': 0.0, 'method': 'screenshot_diff', 'details': [str(e)]}

def verify_click_color_change(pre_image, post_image, x_region=20, y_region=20) -> dict:
    if pre_image is None or post_image is None:
        return {'verified': False, 'confidence': 0.0, 'method': 'color_change', 'details': ['截图失败']}

    try:
        import numpy as np
        pre_arr = np.array(pre_image)
        post_arr = np.array(post_image)

        center_x, center_y = x_region // 2, y_region // 2
        radius = 3
        pre_center = pre_arr[
            max(0, center_y - radius):min(pre_arr.shape[0], center_y + radius + 1),
            max(0, center_x - radius):min(pre_arr.shape[1], center_x + radius + 1),
        ]
        post_center = post_arr[
            max(0, center_y - radius):min(post_arr.shape[0], center_y + radius + 1),
            max(0, center_x - radius):min(post_arr.shape[1], center_x + radius + 1),
        ]

        if pre_center.size == 0 or post_center.size == 0:
            return {'verified': False, 'confidence': 0.0, 'method': 'color_change', 'details': ['区域太小']}

        pre_mean = pre_center.mean(axis=(0, 1))
        post_mean = post_center.mean(axis=(0, 1))
        color_delta = np.sqrt(np.sum((post_mean.astype(float) - pre_mean.astype(float)) ** 2))

        return {
            'verified': color_delta > 20,
            'confidence': min(color_delta / 60, 1.0),
            'method': 'color_change',
            'details': [f'色彩变化 ΔE={color_delta:.1f}'],
        }
    except Exception as e:
        return {'verified': False, 'confidence': 0.0, 'method': 'color_change', 'details': [str(e)]}

def verify_click(x, y) -> ClickVerification:
    pre_path, pre_img = take_region_screenshot(x, y)
    if pre_img is None:
        return ClickVerification(verified=True, method='none', confidence=0.5,
                                  details=['无法截图，跳过验证'])

    time.sleep(0.15)
    post_path, post_img = take_region_screenshot(x, y)
    if post_img is None:
        return ClickVerification(verified=True, method='none', confidence=0.5,
                                  details=['无法截图，跳过验证'])

    diff_result = verify_click_screenshot_diff(pre_img, post_img)
    color_result = verify_click_color_change(post_img, post_img)

    combined = max(
        diff_result.get('confidence', 0),
        color_result.get('confidence', 0),
    )

    details = []
    if diff_result.get('details'):
        details.extend(diff_result['details'])
    if color_result.get('details'):
        details.extend(color_result['details'])

    return ClickVerification(
        verified=combined > 0.3 or diff_result.get('verified', False),
        confidence=combined,
        method='screenshot_diff' if diff_result.get('confidence', 0) >= color_result.get('confidence', 0) else 'color_change',
        details=details,
    )

# =========================================================================
#  Backend: SendInput (Win32 API via ctypes)
# =========================================================================

_SENDINPUT_AVAILABLE = None

def _check_sendinput():
    global _SENDINPUT_AVAILABLE
    if _SENDINPUT_AVAILABLE is not None:
        return _SENDINPUT_AVAILABLE
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        _SENDINPUT_AVAILABLE = hasattr(user32, 'SendInput')
    except Exception:
        _SENDINPUT_AVAILABLE = False
    return _SENDINPUT_AVAILABLE

def _sendinput_move(x, y):
    import ctypes
    from ctypes import wintypes

    INPUT_MOUSE = 0
    MOUSEEVENTF_MOVE = 0x0001
    MOUSEEVENTF_ABSOLUTE = 0x8000

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [
            ('dx', ctypes.c_long),
            ('dy', ctypes.c_long),
            ('mouseData', ctypes.c_ulong),
            ('dwFlags', ctypes.c_ulong),
            ('time', ctypes.c_ulong),
            ('dwExtraInfo', ctypes.POINTER(ctypes.c_ulong)),
        ]

    class INPUT(ctypes.Structure):
        _fields_ = [
            ('type', ctypes.c_ulong),
            ('mi', MOUSEINPUT),
        ]

    screen_w = ctypes.windll.user32.GetSystemMetrics(0)
    screen_h = ctypes.windll.user32.GetSystemMetrics(1)

    norm_x = int(x * 65535 / max(screen_w - 1, 1))
    norm_y = int(y * 65535 / max(screen_h - 1, 1))

    inp = INPUT()
    inp.type = INPUT_MOUSE
    inp.mi = MOUSEINPUT(norm_x, norm_y, 0, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, 0, None)
    ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))

def _sendinput_click(button='left', double=False):
    import ctypes
    from ctypes import wintypes

    INPUT_MOUSE = 0
    MOUSEEVENTF_LEFTDOWN = 0x0002
    MOUSEEVENTF_LEFTUP = 0x0004
    MOUSEEVENTF_RIGHTDOWN = 0x0008
    MOUSEEVENTF_RIGHTUP = 0x0010

    if button == 'left':
        down_flag, up_flag = MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP
    else:
        down_flag, up_flag = MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP

    for _ in range(2 if double else 1):
        _send_single_click(down_flag, up_flag)

def _send_single_click(down_flag, up_flag):
    import ctypes
    from ctypes import wintypes

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [
            ('dx', ctypes.c_long),
            ('dy', ctypes.c_long),
            ('mouseData', ctypes.c_ulong),
            ('dwFlags', ctypes.c_ulong),
            ('time', ctypes.c_ulong),
            ('dwExtraInfo', ctypes.POINTER(ctypes.c_ulong)),
        ]

    class INPUT(ctypes.Structure):
        _fields_ = [
            ('type', ctypes.c_ulong),
            ('mi', MOUSEINPUT),
        ]

    down_inp = INPUT()
    down_inp.type = 0
    down_inp.mi = MOUSEINPUT(0, 0, 0, down_flag, 0, None)
    ctypes.windll.user32.SendInput(1, ctypes.byref(down_inp), ctypes.sizeof(down_inp))

    time.sleep(random.uniform(0.03, 0.08))

    up_inp = INPUT()
    up_inp.type = 0
    up_inp.mi = MOUSEINPUT(0, 0, 0, up_flag, 0, None)
    ctypes.windll.user32.SendInput(1, ctypes.byref(up_inp), ctypes.sizeof(up_inp))

def _sendinput_scroll(delta):
    import ctypes
    from ctypes import wintypes

    INPUT_MOUSE = 0
    MOUSEEVENTF_WHEEL = 0x0800

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [
            ('dx', ctypes.c_long),
            ('dy', ctypes.c_long),
            ('mouseData', ctypes.c_ulong),
            ('dwFlags', ctypes.c_ulong),
            ('time', ctypes.c_ulong),
            ('dwExtraInfo', ctypes.POINTER(ctypes.c_ulong)),
        ]

    class INPUT(ctypes.Structure):
        _fields_ = [
            ('type', ctypes.c_ulong),
            ('mi', MOUSEINPUT),
        ]

    inp = INPUT()
    inp.type = INPUT_MOUSE
    inp.mi = MOUSEINPUT(0, 0, ctypes.c_ulong(delta), MOUSEEVENTF_WHEEL, 0, None)
    ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))

def _sendinput_key_down(key_code):
    import ctypes
    from ctypes import wintypes

    INPUT_KEYBOARD = 1
    KEYEVENTF_KEYDOWN = 0x0000

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [
            ('wVk', ctypes.c_ushort),
            ('wScan', ctypes.c_ushort),
            ('dwFlags', ctypes.c_ulong),
            ('time', ctypes.c_ulong),
            ('dwExtraInfo', ctypes.POINTER(ctypes.c_ulong)),
        ]

    class INPUT(ctypes.Structure):
        _fields_ = [
            ('type', ctypes.c_ulong),
            ('ki', KEYBDINPUT),
        ]

    inp = INPUT()
    inp.type = INPUT_KEYBOARD
    inp.ki = KEYBDINPUT(key_code, 0, KEYEVENTF_KEYDOWN, 0, None)
    ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))

def _sendinput_key_up(key_code):
    import ctypes
    from ctypes import wintypes

    INPUT_KEYBOARD = 1
    KEYEVENTF_KEYUP = 0x0002

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [
            ('wVk', ctypes.c_ushort),
            ('wScan', ctypes.c_ushort),
            ('dwFlags', ctypes.c_ulong),
            ('time', ctypes.c_ulong),
            ('dwExtraInfo', ctypes.POINTER(ctypes.c_ulong)),
        ]

    class INPUT(ctypes.Structure):
        _fields_ = [
            ('type', ctypes.c_ulong),
            ('ki', KEYBDINPUT),
        ]

    inp = INPUT()
    inp.type = INPUT_KEYBOARD
    inp.ki = KEYBDINPUT(key_code, 0, KEYEVENTF_KEYUP, 0, None)
    ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))

# =========================================================================
#  Backend: pyautogui
# =========================================================================

_PYAUTOGUI = None

def _get_pyautogui():
    global _PYAUTOGUI
    if _PYAUTOGUI is None:
        try:
            import pyautogui as pg
            pg.FAILSAFE = False
            _PYAUTOGUI = pg
        except ImportError:
            _PYAUTOGUI = False
    return _PYAUTOGUI if _PYAUTOGUI is not False else None

_KEY_MAP = {
    'enter': 'enter', 'return': 'enter', 'tab': 'tab',
    'escape': 'esc', 'esc': 'esc', 'space': 'space',
    'backspace': 'backspace', 'delete': 'delete',
    'up': 'up', 'down': 'down', 'left': 'left', 'right': 'right',
    'home': 'home', 'end': 'end',
    'pageup': 'pageup', 'pagedown': 'pagedown',
    'f1': 'f1', 'f2': 'f2', 'f3': 'f3', 'f4': 'f4',
    'f5': 'f5', 'f6': 'f6', 'f7': 'f7', 'f8': 'f8',
    'f9': 'f9', 'f10': 'f10', 'f11': 'f11', 'f12': 'f12',
    'shift': 'shift', 'ctrl': 'ctrl', 'alt': 'alt',
    'win': 'win', 'command': 'win',
}

# =========================================================================
#  Main simulation dispatcher
# =========================================================================

def _get_current_mouse_pos():
    try:
        import ctypes
        from ctypes import wintypes
        pt = wintypes.POINT()
        ctypes.windll.user32.GetCursorPos(ctypes.byref(pt))
        return pt.x, pt.y
    except Exception:
        return 0, 0

def execute_action_bezier(action_data: dict, monitor_info: list, profile: MovementProfile) -> dict:
    action = action_data.get('action', 'click')
    x = action_data.get('x')
    y = action_data.get('y')
    text = action_data.get('text', '')
    key = action_data.get('key', '')
    modifiers = action_data.get('modifiers', [])
    delay = action_data.get('delay', 100)

    coord_error = validate_coord(x, y)
    if coord_error:
        return {'success': False, 'error': coord_error}

    cal = calibrate_coord(x, y, monitor_info)
    target_x, target_y = cal.calibrated.x, cal.calibrated.y

    time.sleep(delay / 1000.0)

    if action == 'hover':
        cur_x, cur_y = _get_current_mouse_pos()
        path = plan_mouse_path(cur_x, cur_y, target_x, target_y, profile)
        for pt in path:
            _sendinput_move(pt.x, pt.y)
            time.sleep(0.002)
        return {'success': True, 'backend': 'sendinput', 'calibrated': asdict(cal)}

    elif action in ('click', 'doubleClick', 'rightClick'):
        cur_x, cur_y = _get_current_mouse_pos()
        path = plan_mouse_path(cur_x, cur_y, target_x, target_y, profile)

        for pt in path:
            _sendinput_move(pt.x, pt.y)
            time.sleep(0.002)

        time.sleep(random.uniform(0.02, 0.06))

        for mod in modifiers:
            _sendinput_key_down(_vk_from_mod(mod))
            time.sleep(0.02)

        btn = 'right' if action == 'rightClick' else 'left'
        _sendinput_click(btn, double=(action == 'doubleClick'))

        for mod in reversed(modifiers):
            _sendinput_key_up(_vk_from_mod(mod))
            time.sleep(0.02)

        return {'success': True, 'backend': 'sendinput', 'calibrated': asdict(cal)}

    elif action == 'type':
        pg = _get_pyautogui()
        if pg:
            pg.write(text, interval=random.uniform(0.01, 0.04))
        else:
            for ch in text:
                vk = ord(ch.upper()) if ch.isalpha() else ord(ch)
                _sendinput_key_down(vk)
                time.sleep(random.uniform(0.01, 0.03))
                _sendinput_key_up(vk)
                time.sleep(random.uniform(0.005, 0.015))
        return {'success': True, 'backend': 'sendinput'}

    elif action == 'keyPress':
        vk = _vk_from_key(key)
        if vk is None:
            pg = _get_pyautogui()
            if pg:
                mapped = _KEY_MAP.get(key.lower(), key)
                pg.press(mapped)
                return {'success': True, 'backend': 'pyautogui'}
            return {'success': False, 'error': f'未知按键: {key}'}

        for mod in modifiers:
            _sendinput_key_down(_vk_from_mod(mod))
            time.sleep(0.02)

        _sendinput_key_down(vk)
        time.sleep(random.uniform(0.03, 0.08))
        _sendinput_key_up(vk)

        for mod in reversed(modifiers):
            _sendinput_key_up(_vk_from_mod(mod))
            time.sleep(0.02)

        return {'success': True, 'backend': 'sendinput'}

    elif action == 'scroll':
        delta = action_data.get('scrollDelta', -1)
        cur_x, cur_y = _get_current_mouse_pos()
        path = plan_mouse_path(cur_x, cur_y, target_x, target_y, profile)
        for pt in path:
            _sendinput_move(pt.x, pt.y)
            time.sleep(0.002)
        _sendinput_scroll(int(delta))
        return {'success': True, 'backend': 'sendinput', 'calibrated': asdict(cal)}

    return {'success': False, 'error': f'未知操作: {action}'}

def execute_action_pyautogui(action_data: dict) -> dict:
    action = action_data.get('action', 'click')
    x = action_data.get('x')
    y = action_data.get('y')
    text = action_data.get('text', '')
    key = action_data.get('key', '')
    modifiers = action_data.get('modifiers', [])
    delay = action_data.get('delay', 100)

    pg = _get_pyautogui()
    if pg is None:
        return {'success': False, 'error': 'pyautogui 未安装'}

    pg.PAUSE = delay / 1000.0
    time.sleep(delay / 1000.0)

    try:
        if action in ('click', 'doubleClick', 'rightClick', 'hover'):
            if x is not None and y is not None:
                pg.moveTo(x, y, duration=_pyautogui_duration(x, y))
                for mod in modifiers:
                    pg.keyDown(mod)

                if action == 'click':
                    pg.click()
                elif action == 'doubleClick':
                    pg.doubleClick()
                elif action == 'rightClick':
                    pg.rightClick()

                for mod in modifiers:
                    pg.keyUp(mod)
            return {'success': True, 'backend': 'pyautogui'}

        elif action == 'type' and text:
            pg.write(text, interval=random.uniform(0.01, 0.04))
            return {'success': True, 'backend': 'pyautogui'}

        elif action == 'keyPress' and key:
            mapped = _KEY_MAP.get(key.lower(), key)
            for mod in modifiers:
                pg.keyDown(mod)
            pg.press(mapped)
            for mod in modifiers:
                pg.keyUp(mod)
            return {'success': True, 'backend': 'pyautogui'}

        elif action == 'scroll':
            delta = action_data.get('scrollDelta', -1)
            if x is not None and y is not None:
                pg.moveTo(x, y)
            pg.scroll(int(delta))
            return {'success': True, 'backend': 'pyautogui'}

        return {'success': False, 'error': f'未知操作: {action}'}

    except Exception as e:
        return {'success': False, 'error': str(e), 'backend': 'pyautogui'}

def _pyautogui_duration(target_x, target_y):
    try:
        cur_x, cur_y = _get_current_mouse_pos()
        dist = math.hypot(target_x - cur_x, target_y - cur_y)
        if dist < 5:
            return 0.02
        return min(0.5, max(0.05, dist / 3000))
    except Exception:
        return 0.1

def _vk_from_mod(mod: str) -> int:
    mod_map = {
        'ctrl': 0x11, 'control': 0x11,
        'alt': 0x12,
        'shift': 0x10,
        'win': 0x5B, 'command': 0x5B,
        'meta': 0x5B,
    }
    return mod_map.get(mod.lower(), 0)

def _vk_from_key(key: str) -> Optional[int]:
    vk_map = {
        'enter': 0x0D, 'return': 0x0D, 'tab': 0x09,
        'escape': 0x1B, 'esc': 0x1B, 'space': 0x20,
        'backspace': 0x08, 'delete': 0x2E,
        'up': 0x26, 'down': 0x28, 'left': 0x25, 'right': 0x27,
        'home': 0x24, 'end': 0x23,
        'pageup': 0x21, 'pagedown': 0x22,
        'f1': 0x70, 'f2': 0x71, 'f3': 0x72, 'f4': 0x73,
        'f5': 0x74, 'f6': 0x75, 'f7': 0x76, 'f8': 0x77,
        'f9': 0x78, 'f10': 0x79, 'f11': 0x7A, 'f12': 0x7B,
        'a': 0x41, 'b': 0x42, 'c': 0x43, 'd': 0x44,
        'e': 0x45, 'f': 0x46, 'g': 0x47, 'h': 0x48,
        'i': 0x49, 'j': 0x4A, 'k': 0x4B, 'l': 0x4C,
        'm': 0x4D, 'n': 0x4E, 'o': 0x4F, 'p': 0x50,
        'q': 0x51, 'r': 0x52, 's': 0x53, 't': 0x54,
        'u': 0x55, 'v': 0x56, 'w': 0x57, 'x': 0x58,
        'y': 0x59, 'z': 0x5A,
        '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33,
        '4': 0x34, '5': 0x35, '6': 0x36, '7': 0x37,
        '8': 0x38, '9': 0x39,
    }
    return vk_map.get(key.lower())

# =========================================================================
#  Orchestration: backend selection & fallback
# =========================================================================

def simulate_with_fallback(
    action_data: dict,
    profile: MovementProfile = None,
) -> dict:
    if profile is None:
        profile = MovementProfile()

    backend_override = action_data.get('backend', 'auto')
    enable_verify = action_data.get('verifyClick', False)

    if backend_override != 'auto':
        backends_to_try = [backend_override]
    else:
        backends_to_try = BACKEND_ORDER

    last_error = None
    monitor_info = get_monitor_info()

    for backend in backends_to_try:
        try:
            if backend == 'sendinput' and _check_sendinput():
                result = execute_action_bezier(action_data, monitor_info, profile)
                if result.get('success'):
                    result['backend'] = 'sendinput'

                    if enable_verify and action_data.get('x') is not None:
                        vfy = verify_click(action_data['x'], action_data['y'])
                        result['verification'] = {
                            'verified': vfy.verified,
                            'confidence': vfy.confidence,
                            'method': vfy.method,
                            'details': vfy.details or [],
                        }
                        if not vfy.verified and vfy.confidence < 0.2:
                            result['success'] = False
                            result['error'] = f'点击验证失败 (confidence={vfy.confidence:.2f})'
                            result['verification_failure'] = True

                    return result
                last_error = result.get('error', 'SendInput 失败')

            elif backend == 'pyautogui':
                result = execute_action_pyautogui(action_data)
                if result.get('success'):
                    result['backend'] = 'pyautogui'
                    return result
                last_error = result.get('error', 'pyautogui 失败')

        except PermissionError:
            last_error = '权限错误'
            continue
        except Exception as e:
            last_error = str(e)
            continue

    return {
        'success': False,
        'error': f'所有输入后端均失败: {last_error}',
        'backends_tried': backends_to_try,
    }

# =========================================================================
#  Entry point
# =========================================================================

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': '缺少输入 JSON 参数'}))
        return

    raw = sys.argv[1]
    if raw.startswith('"'):
        raw = raw.strip('"')

    try:
        decoded = unquote(raw)
        action_data = json.loads(decoded)
    except json.JSONDecodeError as e:
        print(json.dumps({'success': False, 'error': f'JSON 解析失败: {e}'}))
        return

    profile_dict = action_data.pop('movementProfile', {})
    profile = MovementProfile.from_dict(profile_dict)

    result = simulate_with_fallback(action_data, profile)

    serializable = {}
    for k, v in result.items():
        if isinstance(v, (dict, list, str, bool, int, float)):
            serializable[k] = v
        elif v is None:
            serializable[k] = None
        elif hasattr(v, '__dict__'):
            serializable[k] = v.__dict__
        else:
            serializable[k] = str(v)

    print(json.dumps(serializable, ensure_ascii=False, default=str))


if __name__ == '__main__':
    main()