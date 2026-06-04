"""
Screen Agent — UIA Bridge (Windows Accessibility Tree)
Called by the TypeScript MCP server to scan accessible UI elements.
Outputs structured JSON to stdout.
"""

import json
import sys
import time
from typing import Optional


def scan_uia():
    start = time.time()
    try:
        import pywinauto
        from pywinauto import Desktop, timings
    except ImportError:
        print(json.dumps({
            'success': False, 'elements': [],
            'focusedApp': None, 'focusedWindow': None,
            'windowBounds': None,
            'error': 'pywinauto not installed. Run: pip install pywinauto',
        }))
        return

    try:
        desktop = Desktop(backend='uia')
        elements = []
        window = desktop.window()

        focused_app = None
        focused_window = None
        window_bounds = None

        try:
            focused_ctl = window.get_focus()
            if focused_ctl:
                focused_app = focused_ctl.process_id()
        except Exception:
            pass

        def walk_uia(parent, depth=0):
            if depth > 10:
                return
            try:
                for child in parent.children():
                    try:
                        label = child.window_text() or child.element_info.name or ''
                        ctrl_type = child.element_info.control_type or 'Unknown'
                        rect = child.element_info.rectangle
                        if not label.strip() or rect.width() < 5 or rect.height() < 5:
                            continue

                        el_id = f'uia_{rect.left}_{rect.top}_{rect.width()}_{rect.height()}'
                        type_map = {
                            'Button': 'button', 'Edit': 'input', 'Document': 'input',
                            'Hyperlink': 'link', 'CheckBox': 'checkbox', 'RadioButton': 'radio',
                            'ComboBox': 'combo', 'Slider': 'slider', 'List': 'list',
                            'Table': 'table', 'Tree': 'tree', 'MenuItem': 'menu',
                            'Window': 'window', 'Pane': 'pane', 'Text': 'text',
                            'TitleBar': 'title', 'ScrollBar': 'scrollbar',
                        }

                        elements.append({
                            'id': el_id,
                            'label': label.strip(),
                            'type': type_map.get(ctrl_type, ctrl_type.lower()),
                            'bounds': {
                                'x': rect.left, 'y': rect.top,
                                'width': rect.width(), 'height': rect.height(),
                            },
                            'center': {
                                'x': rect.left + rect.width() // 2,
                                'y': rect.top + rect.height() // 2,
                            },
                            'isEnabled': child.is_enabled() if hasattr(child, 'is_enabled') else True,
                            'isVisible': child.is_visible() if hasattr(child, 'is_visible') else True,
                            'isFocused': child.has_keyboard_focus() if hasattr(child, 'has_keyboard_focus') else False,
                            'value': child.element_info.help_text or None,
                            'className': child.element_info.class_name or None,
                            'automationId': child.element_info.automation_id or None,
                            'source': 'uia',
                        })
                        walk_uia(child, depth + 1)
                    except Exception:
                        continue
            except Exception:
                pass

        walk_uia(window)

        try:
            main = desktop.window()
            rect = main.element_info.rectangle
            window_bounds = {'x': rect.left, 'y': rect.top, 'width': rect.width(), 'height': rect.height()}
        except Exception:
            pass

        print(json.dumps({
            'success': True,
            'elements': elements,
            'focusedApp': focused_app,
            'focusedWindow': focused_window,
            'windowBounds': window_bounds,
            'duration': (time.time() - start) * 1000,
        }, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({
            'success': False, 'elements': [],
            'focusedApp': None, 'focusedWindow': None,
            'windowBounds': None,
            'error': str(e),
        }))


if __name__ == '__main__':
    scan_uia()
