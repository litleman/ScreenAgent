"""
Screen Agent — UIA Bridge test
"""
import json
import sys

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


def _walk_uia(parent, depth=0, max_depth=10):
    if depth > max_depth:
        return []
    results = []
    try:
        for child in parent.children():
            try:
                info = child.element_info
                label = child.window_text() or info.name or ''
                ctrl_type = info.control_type or 'Unknown'
                rect = info.rectangle
                if not label.strip() or rect.width() < 5 or rect.height() < 5:
                    sub = _walk_uia(child, depth + 1, max_depth)
                    if sub:
                        results.extend(sub)
                    continue
                results.append({
                    'label': label.strip(),
                    'type': _TYPE_MAP.get(ctrl_type, ctrl_type.lower()),
                    'bounds': {'x': rect.left, 'y': rect.top,
                               'width': rect.width(), 'height': rect.height()},
                })
                results.extend(_walk_uia(child, depth + 1, max_depth))
            except Exception as e:
                pass
    except Exception:
        pass
    return results


import pywinauto
from pywinauto import Desktop

desktop = Desktop(backend='uia')
wins = desktop.windows()
for i, win in enumerate(wins):
    title = win.window_text() or win.element_info.name or 'no title'
    elements = _walk_uia(win)
    print('Window {}: {} -> {} elements'.format(i, title[:50], len(elements)))
    for j, el in enumerate(elements[:5]):
        b = el['bounds']
        print('  [{}] {}: {} at ({},{}) {}x{}'.format(
            j, el['type'], el['label'][:40],
            b['x'], b['y'], b['width'], b['height']))
    if len(elements) > 5:
        print('  ... and {} more'.format(len(elements) - 5))
