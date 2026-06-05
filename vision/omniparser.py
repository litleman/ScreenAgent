"""
Screen Agent — Vision Sidecar (OCR + Element Detection)
Python child process called by the TypeScript MCP server.
Outputs structured JSON of screen elements to stdout.

Phase 1 enhancements:
  - NMS (Non-Maximum Suppression) to merge overlapping OCR boxes
  - Adjacent text merging on the same line
  - Noise filtering (size/confidence/aspect ratio)
  - Confidence calibration by element type
"""

import json
import sys
import time
import os
import hashlib
from dataclasses import dataclass, asdict
from typing import Optional
from math import sqrt

import numpy as np
import cv2
from PIL import Image, ImageGrab

CACHE_DIR = os.path.join(os.path.dirname(__file__), '..', 'screenshots')
os.makedirs(CACHE_DIR, exist_ok=True)

# ── Tunable parameters (GUIPruner-inspired token pruning) ──────────────
NMS_IOU_THRESHOLD = 0.45
MIN_CONFIDENCE = 0.35
MAX_ELEMENT_WIDTH_RATIO = 0.95
MAX_ELEMENT_HEIGHT_RATIO = 0.80
MIN_ELEMENT_PX = 8
MAX_ELEMENT_PX = 2000
ADJACENT_TEXT_DISTANCE = 8
TITLE_MAX_HEIGHT = 40
TITLE_MIN_ASPECT = 4
TEXT_MIN_HEIGHT = 50
TEXT_MIN_WIDTH = 180

@dataclass
class Bounds:
    x: int
    y: int
    width: int
    height: int

@dataclass
class ScreenElement:
    id: str
    label: str
    type: str
    bounds: dict
    center: dict
    is_enabled: bool = True
    is_visible: bool = True
    is_focused: bool = False
    value: Optional[str] = None
    description: Optional[str] = None
    source: str = 'ocr'
    confidence: float = 0.0

_ocr_reader = None
_ocr_init_attempted = False

def get_ocr():
    global _ocr_reader, _ocr_init_attempted
    if _ocr_reader is None and not _ocr_init_attempted:
        _ocr_init_attempted = True
        try:
            import easyocr
            print("[INFO] easyocr 正在下载/加载识别模型 (~100MB)，首次运行可能需要几分钟...", file=sys.stderr)
            _ocr_reader = easyocr.Reader(['ch_sim', 'en'], gpu=False)
            print("[INFO] easyocr 模型就绪", file=sys.stderr)
        except ImportError:
            print("[WARN] easyocr not installed. Run: pip install easyocr", file=sys.stderr)
        except Exception as e:
            print(f"[WARN] easyocr 初始化失败: {e}", file=sys.stderr)
            print("[WARN] OCR 功能不可用，将仅使用 UIA 模式运行", file=sys.stderr)
    return _ocr_reader

def take_screenshot():
    pil_img = ImageGrab.grab(all_screens=True)
    ts = int(time.time() * 1000)
    path = os.path.join(CACHE_DIR, f'screen_{ts}.png')
    pil_img.save(path, 'PNG')
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR), path

def compute_hash(img):
    return hashlib.md5(img.tobytes()).hexdigest()

# ── Token pruning helpers (GUIPruner-inspired) ─────────────────────────

def compute_iou(a: Bounds, b: Bounds) -> float:
    x_overlap = max(0, min(a.x + a.width, b.x + b.width) - max(a.x, b.x))
    y_overlap = max(0, min(a.y + a.height, b.y + b.height) - max(a.y, b.y))
    intersection = x_overlap * y_overlap
    union = a.width * a.height + b.width * b.height - intersection
    return intersection / union if union > 0 else 0.0

def compute_distance(a: Bounds, b: Bounds) -> float:
    ca_x, ca_y = a.x + a.width / 2, a.y + a.height / 2
    cb_x, cb_y = b.x + b.width / 2, b.y + b.height / 2
    return sqrt((ca_x - cb_x) ** 2 + (ca_y - cb_y) ** 2)

def merge_overlapping_boxes(elements: list) -> list:
    sorted_els = sorted(elements, key=lambda e: e.confidence, reverse=True)
    kept = []
    for el in sorted_els:
        merged = False
        for i, existing in enumerate(kept):
            iou = compute_iou(
                Bounds(**existing.bounds),
                Bounds(**el.bounds),
            )
            if iou > NMS_IOU_THRESHOLD:
                eb = Bounds(**el.bounds)
                xb = Bounds(**existing.bounds)
                merged_bounds = Bounds(
                    x=min(eb.x, xb.x),
                    y=min(eb.y, xb.y),
                    width=max(eb.x + eb.width, xb.x + xb.width) - min(eb.x, xb.x),
                    height=max(eb.y + eb.height, xb.y + xb.height) - min(eb.y, xb.y),
                )
                merged_label = el.label if el.confidence > existing.confidence else existing.label
                merged_conf = max(el.confidence, existing.confidence)
                kept[i] = ScreenElement(
                    id=f'ocr_{merged_bounds.x}_{merged_bounds.y}_{merged_bounds.width}_{merged_bounds.height}',
                    label=merged_label,
                    type=existing.type if existing.confidence > el.confidence else el.type,
                    bounds=asdict(merged_bounds),
                    center={'x': merged_bounds.x + merged_bounds.width // 2, 'y': merged_bounds.y + merged_bounds.height // 2},
                    confidence=merged_conf,
                    source='ocr',
                )
                merged = True
                break
        if not merged:
            kept.append(el)
    return kept

def merge_adjacent_text(elements: list) -> list:
    if not elements:
        return []
    sorted_by_y = sorted(elements, key=lambda e: (e.bounds['y'], e.bounds['x']))
    merged = []
    used = [False] * len(sorted_by_y)

    for i, el in enumerate(sorted_by_y):
        if used[i]:
            continue
        eb = Bounds(**el.bounds)
        row = [i]
        for j in range(i + 1, len(sorted_by_y)):
            if used[j]:
                continue
            jb = Bounds(**sorted_by_y[j].bounds)
            y_overlap = max(0, min(eb.y + eb.height, jb.y + jb.height) - max(eb.y, jb.y))
            y_span = max(eb.y + eb.height, jb.y + jb.height) - min(eb.y, jb.y)
            same_row = y_span > 0 and y_overlap / y_span > 0.3
            close_x = abs(jb.x - (eb.x + eb.width)) < ADJACENT_TEXT_DISTANCE
            if same_row and close_x:
                row.append(j)
                used[j] = True
                nw = jb.x + jb.width - eb.x
                nh = max(eb.y + eb.height, jb.y + jb.height) - min(eb.y, jb.y)
                eb = Bounds(x=min(eb.x, jb.x), y=min(eb.y, jb.y), width=nw, height=nh)
        if len(row) > 1:
            texts = [sorted_by_y[k].label for k in row]
            confs = [sorted_by_y[k].confidence for k in row]
            merged_el = ScreenElement(
                id=f'ocr_{eb.x}_{eb.y}_{eb.width}_{eb.height}',
                label=''.join(texts),
                type=el.type,
                bounds=asdict(eb),
                center={'x': eb.x + eb.width // 2, 'y': eb.y + eb.height // 2},
                confidence=max(confs),
                source='ocr',
            )
            merged.append(merged_el)
            used[i] = True
        elif len(row) == 1:
            merged.append(el)

    return merged

def filter_noise(elements: list, screen_width: int, screen_height: int) -> list:
    filtered = []
    for el in elements:
        b = Bounds(**el.bounds)
        if b.width < MIN_ELEMENT_PX or b.height < MIN_ELEMENT_PX:
            continue
        if b.width > screen_width * MAX_ELEMENT_WIDTH_RATIO:
            continue
        if b.height > screen_height * MAX_ELEMENT_HEIGHT_RATIO:
            continue
        if b.width > MAX_ELEMENT_PX or b.height > MAX_ELEMENT_PX:
            continue
        aspect = b.width / max(b.height, 1)
        if aspect > 20 and b.height < 3:
            continue
        if el.confidence < MIN_CONFIDENCE:
            continue
        filtered.append(el)
    return filtered

def calibrate_confidence(el: ScreenElement) -> ScreenElement:
    base = el.confidence
    if el.source == 'uia':
        base = max(base, 0.85)
    w, h = el.bounds['width'], el.bounds['height']
    area = w * h
    if 200 < area < 50000:
        base = min(base + 0.05, 1.0)
    aspect = w / max(h, 1)
    if 2 < aspect < 10 and h < 40:
        base = min(base + 0.03, 1.0)
    el.confidence = round(base, 4)
    return el

# ── Element type guessing ──────────────────────────────────────────────

def guess_element_type(label, bounds):
    label_lower = label.lower().strip()
    if any(w in label_lower for w in ['按钮', 'button', 'click', '提交', '确定', '确认', '取消', '保存']):
        return 'button'
    if any(w in label_lower for w in ['输入', 'input', '搜索', 'search', '查找', 'find', '编辑', 'edit']):
        return 'input'
    if any(w in label_lower for w in ['链接', 'link', '超链接', 'hyperlink']):
        return 'link'
    if any(w in label_lower for w in ['复选框', 'checkbox', '勾选']):
        return 'checkbox'
    if any(w in label_lower for w in ['单选', 'radio']):
        return 'radio'
    if any(w in label_lower for w in ['下拉', 'dropdown', '选择', 'select']):
        return 'combo'
    if any(w in label_lower for w in ['滑动', 'slider', '进度']):
        return 'slider'
    if any(w in label_lower for w in ['列表', 'list']):
        return 'list'
    if any(w in label_lower for w in ['菜单', 'menu']):
        return 'menu'
    if any(w in label_lower for w in ['对话框', 'dialog', '提示']):
        return 'dialog'
    if any(w in label_lower for w in ['标题', 'title']):
        return 'title'
    aspect = bounds.width / max(bounds.height, 1)
    if aspect > TITLE_MIN_ASPECT and bounds.height < TITLE_MAX_HEIGHT:
        return 'title'
    if bounds.height > TEXT_MIN_HEIGHT and bounds.width > TEXT_MIN_WIDTH:
        return 'text'
    return 'text'

# ── OCR pipeline ───────────────────────────────────────────────────────

def ocr_screen(img):
    reader = get_ocr()
    if reader is None:
        return []
    results = reader.readtext(img)
    raw_elements = []
    for bbox, text, conf in results:
        if not text.strip():
            continue
        if conf < 0.2:
            continue
        x_coords = [int(p[0]) for p in bbox]
        y_coords = [int(p[1]) for p in bbox]
        bounds = Bounds(
            x=min(x_coords), y=min(y_coords),
            width=max(x_coords) - min(x_coords),
            height=max(y_coords) - min(y_coords),
        )
        if bounds.width < 3 or bounds.height < 3:
            continue
        el = ScreenElement(
            id='', label=text.strip(), type=guess_element_type(text.strip(), bounds),
            bounds=asdict(bounds),
            center={'x': bounds.x + bounds.width // 2, 'y': bounds.y + bounds.height // 2},
            confidence=conf, source='ocr',
        )
        raw_elements.append(el)

    screen_h, screen_w = img.shape[:2]
    deduped = merge_overlapping_boxes(raw_elements)
    merged = merge_adjacent_text(deduped)
    filtered = filter_noise(merged, screen_w, screen_h)
    edge_refined = refine_bounds_with_edges(img, filtered)

    for i, el in enumerate(edge_refined):
        calibrated = calibrate_confidence(el)
        calibrated.id = f'ocr_{calibrated.bounds["x"]}_{calibrated.bounds["y"]}_{calibrated.bounds["width"]}_{calibrated.bounds["height"]}'
        edge_refined[i] = calibrated

    return edge_refined

# ── Edge detection & bounds refinement ────────────────────────────────

def refine_bounds_with_edges(img, elements: list) -> list:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blurred, 30, 100)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    edges = cv2.dilate(edges, kernel, iterations=1)

    refined = []
    for el in elements:
        b = Bounds(**el.bounds)
        margin_x = max(1, b.width // 10)
        margin_y = max(1, b.height // 10)
        x1 = max(0, b.x - margin_x)
        y1 = max(0, b.y - margin_y)
        x2 = min(edges.shape[1] - 1, b.x + b.width + margin_x)
        y2 = min(edges.shape[0] - 1, b.y + b.height + margin_y)

        region = edges[y1:y2, x1:x2]
        edge_pixels = np.where(region > 0)

        if len(edge_pixels[0]) < 5:
            refined.append(el)
            continue

        min_y = y1 + int(np.percentile(edge_pixels[0], 5))
        max_y = y1 + int(np.percentile(edge_pixels[0], 95))
        min_x = x1 + int(np.percentile(edge_pixels[1], 5))
        max_x = x1 + int(np.percentile(edge_pixels[1], 95))

        nb = Bounds(
            x=max(b.x, min_x),
            y=max(b.y, min_y),
            width=min(b.x + b.width, max_x) - max(b.x, min_x),
            height=min(b.y + b.height, max_y) - max(b.y, min_y),
        )
        if nb.width > 5 and nb.height > 3:
            el.bounds = asdict(nb)
            el.center = {'x': nb.x + nb.width // 2, 'y': nb.y + nb.height // 2}
            el.id = f'ocr_{nb.x}_{nb.y}_{nb.width}_{nb.height}'
        refined.append(el)
    return refined

# ── Loading detection ──────────────────────────────────────────────────

def detect_loading(img):
    indicators = []
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    circles = cv2.HoughCircles(gray, cv2.HOUGH_GRADIENT, dp=1, minDist=50, param1=50, param2=30, minRadius=5, maxRadius=30)
    if circles is not None:
        indicators.append('spinner_detected')
    gray_region = cv2.inRange(gray, 200, 255)
    gray_ratio = cv2.countNonZero(gray_region) / max(gray.size, 1)
    if gray_ratio > 0.6:
        indicators.append(f'gray_overlay_{gray_ratio:.2f}')
    return indicators

def main():
    start = time.time()
    try:
        force = '--force' in sys.argv
        img, screenshot_path = take_screenshot()
        img_hash = compute_hash(img)
        cache_path = os.path.join(CACHE_DIR, f'cache_{img_hash}.json')
        if not force and os.path.exists(cache_path):
            with open(cache_path, 'r', encoding='utf-8') as f:
                cached = json.load(f)
            cached['cached'] = True
            cached['screenshot_path'] = screenshot_path
            cached['duration'] = (time.time() - start) * 1000
            print(json.dumps(cached, ensure_ascii=False))
            return
        elements = ocr_screen(img)
        loading = detect_loading(img)
        result = {
            'success': True,
            'elements': [asdict(el) for el in elements],
            'screenshot_path': screenshot_path,
            'isLoading': len(loading) > 0,
            'loadingIndicators': loading,
            'duration': (time.time() - start) * 1000,
        }
        cache_data = {
            'success': True,
            'elements': [asdict(el) for el in elements],
            'screenshot_path': None,
            'isLoading': len(loading) > 0,
            'loadingIndicators': loading,
        }
        with open(cache_path, 'w', encoding='utf-8') as f:
            json.dump(cache_data, f, ensure_ascii=False)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({
            'success': False, 'elements': [], 'screenshot_path': None,
            'error': str(e), 'duration': (time.time() - start) * 1000,
        }, ensure_ascii=False))

if __name__ == '__main__':
    main()
