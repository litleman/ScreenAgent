"""
Screen Agent — UIA Bridge (Windows Accessibility Tree)
Called by the TypeScript MCP server to scan accessible UI elements.
Outputs structured JSON to stdout.
"""

import json
import sys
import time
import ctypes
from ctypes import wintypes
from typing import Optional


# 映射 UIA control_type → 语义类型
_TYPE_MAP = {
    'Button': 'button', 'Edit': 'input', 'Document': 'input',
    'Hyperlink': 'link', 'CheckBox': 'checkbox', 'RadioButton': 'radio',
    'ComboBox': 'combo', 'Slider': 'slider', 'List': 'list',
    'Table': 'table', 'Tree': 'tree', 'MenuItem': 'menu',
    'Window': 'window', 'Pane': 'pane', 'Text': 'text',
    'TitleBar': 'title', 'ScrollBar': 'scrollbar',
    'Tab': 'tab', 'ToolBar': 'toolbar', 'StatusBar': 'statusbar',
    'ProgressBar': 'progress', 'Image': 'image', 'Calendar': 'calendar',
    'Spinner': 'spinner', 'Separator': 'separator', 'ToolTip': 'tooltip',
    'Header': 'header', 'DataItem': 'item', 'ListItem': 'item',
    'MenuBar': 'menu', 'Custom': 'custom',
}


_DIALOG_KEYWORDS = [
    '提示', '警告', '错误', '确认', '消息', '询问', '信息',
    'Info', 'Warning', 'Error', 'Confirm', 'Question', 'Message',
]

_DIALOG_THRESHOLD = 35


def _get_window_style(hwnd):
    try:
        user32 = ctypes.windll.user32
        style = user32.GetWindowLongW(wintypes.HANDLE(hwnd), -16)
        ex_style = user32.GetWindowLongW(wintypes.HANDLE(hwnd), -20)
        return style, ex_style
    except Exception:
        return None, None


def _score_dialog(win, win_info, win_rect):
    score = 0

    hwnd = getattr(win_info, 'handle', None)
    if hwnd:
        style, ex_style = _get_window_style(hwnd)
        if style is not None:
            if style & 0x400000: score += 30
            if style & 0x80000000: score += 10
            if ex_style & 0x0001: score += 20

    try:
        if win.is_modal(): score += 40
    except Exception:
        pass

    title = win_info.name or win.window_text() or ''
    for kw in _DIALOG_KEYWORDS:
        if kw.lower() in title.lower():
            score += 15
            break

    try:
        parent = win.parent()
        if parent is not None:
            try:
                pr = parent.element_info.rectangle
                wr = win_rect
                cx_diff = abs((wr.left + wr.width // 2) - (pr.left + pr.width // 2))
                cy_diff = abs((wr.top + wr.height // 2) - (pr.top + pr.height // 2))
                if cx_diff < wr.width and cy_diff < wr.height:
                    score += 15
            except Exception:
                pass
    except Exception:
        pass

    return score


def _overlaps(a, b):
    return (
        a.left < b.left + b.width() and a.left + a.width() > b.left
        and a.top < b.top + b.height() and a.top + a.height() > b.top
    )


def _walk_uia(parent, depth=0, max_depth=10):
    if depth > max_depth:
        return []
    try:
        results = []
        children = parent.children()
        for child in children:
            try:
                info = child.element_info
                label = child.window_text() or info.name or ''
                ctrl_type = info.control_type or 'Unknown'
                rect = info.rectangle
            except Exception:
                continue

            has_label = bool(label.strip())
            big_enough = rect.width() >= 5 and rect.height() >= 5

            if not has_label or not big_enough:
                sub = _walk_uia(child, depth + 1, max_depth)
                if sub:
                    results.extend(sub)
                continue

            el_id = 'uia_{}_{}_{}_{}'.format(rect.left, rect.top, rect.width(), rect.height())

            is_enabled = True
            try:
                is_enabled = child.is_enabled()
            except Exception:
                pass

            is_visible = True
            try:
                is_visible = child.is_visible()
            except Exception:
                pass

            is_focused = False
            try:
                is_focused = child.has_keyboard_focus()
            except Exception:
                pass

            results.append({
                'id': el_id,
                'label': label.strip(),
                'type': _TYPE_MAP.get(ctrl_type, ctrl_type.lower()),
                'bounds': {'x': rect.left, 'y': rect.top, 'width': rect.width(), 'height': rect.height()},
                'center': {'x': rect.left + rect.width() // 2, 'y': rect.top + rect.height() // 2},
                'isEnabled': is_enabled,
                'isVisible': is_visible,
                'isFocused': is_focused,
                'value': getattr(info, 'help_text', None),
                'className': getattr(info, 'class_name', None),
                'automationId': getattr(info, 'automation_id', None),
                'source': 'uia',
            })
            sub = _walk_uia(child, depth + 1, max_depth)
            if sub:
                results.extend(sub)
        return results
    except Exception:
        return []


def _get_menu_items(window, max_depth=8):
    """深度优先遍历窗口下的 Menu/MenuBar/ContextMenu 元素，返回结构化的菜单项列表。"""
    menu_items = []
    try:
        queue = [(window, 0)]
        while queue:
            parent, depth = queue.pop(0)
            if depth > max_depth:
                continue
            try:
                children = parent.children()
            except Exception:
                continue
            for child in children:
                try:
                    info = child.element_info
                    ctrl_type = info.control_type or ''
                except Exception:
                    continue
                is_menu = ctrl_type in ('Menu', 'MenuBar', 'MenuItem', 'ContextMenu')
                if is_menu:
                    try:
                        label = child.window_text() or info.name or ''
                        rect = info.rectangle
                        try:
                            is_enabled = child.is_enabled()
                        except Exception:
                            is_enabled = True
                        try:
                            is_visible = child.is_visible()
                        except Exception:
                            is_visible = True
                        has_submenu = False
                        try:
                            # 检查子元素中是否还有 MenuItem
                            for sub in child.children():
                                si = sub.element_info
                                if si.control_type == 'MenuItem':
                                    has_submenu = True
                                    break
                        except Exception:
                            pass
                        menu_items.append({
                            'id': 'menu_{}_{}_{}_{}'.format(
                                rect.left, rect.top, rect.width(), rect.height()),
                            'label': label.strip(),
                            'controlType': ctrl_type,
                            'bounds': {'x': rect.left, 'y': rect.top,
                                       'width': rect.width(), 'height': rect.height()},
                            'center': {'x': rect.left + rect.width() // 2,
                                       'y': rect.top + rect.height() // 2},
                            'isEnabled': is_enabled,
                            'isVisible': is_visible,
                            'hasSubMenu': has_submenu,
                        })
                    except Exception:
                        pass
                queue.append((child, depth + 1))
    except Exception:
        pass
    return menu_items


def scan_uia():
    start = time.time()
    try:
        import pywinauto
        from pywinauto import Desktop, timings
    except ImportError:
        print(json.dumps({
            'success': False, 'elements': [],
            'focusedApp': None, 'focusedWindow': None,
            'windows': [], 'windowBounds': None,
            'error': 'pywinauto not installed. Run: pip install pywinauto',
        }, ensure_ascii=False))
        return

    try:
        desktop = Desktop(backend='uia')

        # --- 第一遍：收集原始窗口数据 ---
        raw_windows = []
        for win in desktop.windows():
            try:
                win_info = win.element_info
                win_rect = win_info.rectangle
                if win_rect.width() < 20 or win_rect.height() < 20:
                    continue

                win_handle = getattr(win_info, 'handle', None) or win_info.runtime_id or str(id(win))
                win_title = win.window_text() or win_info.name or ''
                raw_windows.append({
                    'handle': str(win_handle),
                    'info': win_info,
                    'rect': win_rect,
                    'title': win_title,
                    'win': win,
                })
            except Exception:
                continue

        # --- 第二遍：分析弹窗关系 ---
        window_scores = {}
        for rw in raw_windows:
            score = _score_dialog(rw['win'], rw['info'], rw['rect'])
            window_scores[rw['handle']] = score

        dialog_map = {}  # handle → bool
        for h, s in window_scores.items():
            dialog_map[h] = s >= _DIALOG_THRESHOLD

        blocked_map = {}  # handle → blocking_dialog_handle | None
        for rw in raw_windows:
            h = rw['handle']
            if dialog_map.get(h, False):
                blocked_map[h] = None  # dialogs don't get blocked
                continue
            # find any dialog that overlaps this window
            for drw in raw_windows:
                dh = drw['handle']
                if not dialog_map.get(dh, False):
                    continue
                if _overlaps(rw['rect'], drw['rect']):
                    blocked_map[h] = dh
                    break

        # --- 第三遍：构建输出 ---
        all_elements = []
        all_menu_items = []
        window_infos = []
        focused_app = None
        focused_window = None
        window_bounds = None
        dialog_windows = []

        for rw in raw_windows:
            win = rw['win']
            win_info = rw['info']
            win_rect = rw['rect']
            win_handle = rw['handle']
            win_title = rw['title']

            is_focused = _has_focus(win)
            is_dialog = dialog_map.get(win_handle, False)
            blocked_by = blocked_map.get(win_handle, None)

            if is_focused:
                focused_app = str(win_info.process_id)
                focused_window = win_title
                window_bounds = {
                    'x': win_rect.left, 'y': win_rect.top,
                    'width': win_rect.width(), 'height': win_rect.height(),
                }

            win_elements = _walk_uia(win)
            for el in win_elements:
                el['windowId'] = win_handle
            all_elements.extend(win_elements)

            win_menu_items = _get_menu_items(win)
            for m in win_menu_items:
                m['windowId'] = win_handle
            all_menu_items.extend(win_menu_items)

            entry = {
                'id': win_handle,
                'processId': str(win_info.process_id),
                'title': win_title,
                'processName': win_info.class_name or '',
                'bounds': {
                    'x': win_rect.left, 'y': win_rect.top,
                    'width': win_rect.width(), 'height': win_rect.height(),
                },
                'isMinimized': _is_minimized(win),
                'isMaximized': _is_maximized(win),
                'isFocused': is_focused,
                'isDialog': is_dialog,
                'blockedBy': blocked_by,
                'zOrder': 0,
                'elementCount': len(win_elements),
            }
            window_infos.append(entry)

            if is_dialog:
                dialog_windows.append({
                    'id': win_handle,
                    'title': win_title,
                    'blocksWindowId': blocked_by,
                })

        print(json.dumps({
            'success': True,
            'elements': all_elements,
            'menuItems': all_menu_items,
            'focus': {
                'app': focused_app,
                'window': focused_window,
            },
            'windows': window_infos,
            'dialogWindows': dialog_windows,
            'windowBounds': window_bounds,
            'duration': (time.time() - start) * 1000,
        }, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({
            'success': False, 'elements': [],
            'focus': {'app': None, 'window': None},
            'windows': [], 'dialogWindows': [],
            'windowBounds': None,
            'error': str(e),
        }, ensure_ascii=False))


def _is_minimized(win):
    try:
        return win.is_minimized()
    except Exception:
        return False


def _is_maximized(win):
    try:
        return win.is_maximized()
    except Exception:
        return False


def _has_focus(win):
    try:
        return win.has_keyboard_focus()
    except Exception:
        pass
    try:
        return win.is_active()
    except Exception:
        pass
    return False


# ── Invoke mode (P2: UIA InvokePattern for menu items) ──────────────────

def invoke_element(label=None, automation_id=None):
    """Find an element by label or automationId and call InvokePattern."""
    try:
        import pywinauto
        from pywinauto import Desktop
        from pywinauto.controls.uiawrapper import UIAWrapper
    except ImportError:
        print(json.dumps({
            'success': False, 'error': 'pywinauto not installed',
        }, ensure_ascii=False))
        return

    start = time.time()
    try:
        desktop = Desktop(backend='uia')

        def search_element(parent):
            """DFS search for element matching label or automation_id."""
            try:
                children = parent.children()
            except Exception:
                return None
            for child in children:
                try:
                    info = child.element_info
                    ctrl_name = child.window_text() or info.name or ''
                    ctrl_id = getattr(info, 'automation_id', None)
                except Exception:
                    continue

                if label and label.lower() in ctrl_name.lower():
                    return child
                if automation_id and ctrl_id and automation_id.lower() in ctrl_id.lower():
                    return child

                found = search_element(child)
                if found is not None:
                    return found
            return None

        target = search_element(desktop)
        if target is None:
            print(json.dumps({
                'success': False, 'error': '未找到匹配元素',
                'label': label, 'automationId': automation_id,
            }, ensure_ascii=False))
            return

        try:
            target.invoke()
            print(json.dumps({
                'success': True, 'method': 'InvokePattern',
                'label': label or automation_id,
                'duration': (time.time() - start) * 1000,
            }, ensure_ascii=False))
            return
        except Exception as invoke_err:
            pass

        try:
            target.click_input()
            print(json.dumps({
                'success': True, 'method': 'click_input_fallback',
                'label': label or automation_id,
                'duration': (time.time() - start) * 1000,
            }, ensure_ascii=False))
            return
        except Exception as click_err:
            print(json.dumps({
                'success': False, 'error': 'InvokePattern 和 click_input 均失败',
                'invokeError': str(invoke_err), 'clickError': str(click_err),
                'label': label, 'automationId': automation_id,
            }, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({
            'success': False, 'error': str(e),
            'label': label, 'automationId': automation_id,
        }, ensure_ascii=False))


if __name__ == '__main__':
    import sys
    args = sys.argv[1:]

    invoke_idx = None
    for i, a in enumerate(args):
        if a == '--invoke':
            invoke_idx = i
            break

    if invoke_idx is not None:
        invoke_label = None
        invoke_aid = None
        for a in args[invoke_idx + 1:]:
            if a == '--invoke':
                break
            if a.startswith('label='):
                invoke_label = a[len('label='):]
            elif a.startswith('automationId='):
                invoke_aid = a[len('automationId='):]
        invoke_element(label=invoke_label, automation_id=invoke_aid)
    else:
        scan_uia()
