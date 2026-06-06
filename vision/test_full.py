"""Screen Agent 全面测试脚本"""
import json, sys, time
sys.path.insert(0, r'D:\Administrator\allWorkFiles\桌面视觉代理引擎\screen-agent\vision')

# 测试 2b: scan_uia() 修正确认 — 直接构建正确的扫描
from pywinauto import Desktop
desktop = Desktop(backend='uia')

print(f"\n=== 测试 2b: 自己构建 UIA 遍历 ===")
elements = []
def walk_children(parent, depth=0, max_depth=8):
    if depth > max_depth:
        return
    try:
        for child in parent.children():
            try:
                label = child.window_text() or child.element_info.name or ''
                rect = child.element_info.rectangle
                ctrl_type = child.element_info.control_type or 'Unknown'
                if rect.width() < 5 or rect.height() < 5:
                    continue
                type_map = {
                    'Button': 'button', 'Edit': 'input', 'Document': 'input',
                    'Hyperlink': 'link', 'CheckBox': 'checkbox', 'RadioButton': 'radio',
                    'ComboBox': 'combo', 'Slider': 'slider', 'List': 'list',
                    'Table': 'table', 'Tree': 'tree', 'MenuItem': 'menu',
                    'Window': 'window', 'Pane': 'pane', 'Text': 'text',
                    'TitleBar': 'title', 'ScrollBar': 'scrollbar',
                }
                el = {
                    'label': label.strip()[:40],
                    'type': type_map.get(ctrl_type, ctrl_type.lower()),
                    'bounds': f"({rect.left},{rect.top} {rect.width()}x{rect.height()})",
                    'ctrl_type': ctrl_type,
                    'isEnabled': child.is_enabled() if hasattr(child, 'is_enabled') else True,
                    'depth': depth,
                }
                elements.append(el)
                walk_children(child, depth + 1, max_depth)
            except:
                pass
    except:
        pass

for win in desktop.windows():
    walk_children(win, depth=1)

print(f"元素总数: {len(elements)}")

# 按窗口分组
from collections import defaultdict
by_type = defaultdict(list)
for el in elements:
    by_type[el['ctrl_type']].append(el['label'])

for ctrl_type, labels in sorted(by_type.items(), key=lambda x: -len(x[1])):
    print(f"  {ctrl_type}: {len(labels)}项")
    for lbl in labels[:3]:
        print(f"    - '{lbl}'")
    if len(labels) > 3:
        print(f"    ... 还有 {len(labels)-3} 项")

# 测试 Notepad 具体
notepad_wins = [w for w in desktop.windows() if 'Notepad' in w.element_info.class_name]
print(f"\n=== Notepad 窗口: {len(notepad_wins)} ===")
for w in notepad_wins:
    print(f"  title='{w.window_text()}' rect={w.element_info.rectangle}")

# 测试 3: 弹出菜单扫描
print(f"\n=== 测试 3: Menu/Popup 检测 ===")
all_windows = desktop.windows()
menu_wins = []
for w in all_windows:
    try:
        ctrl = w.element_info.control_type
        if ctrl in ('Menu', 'MenuBar', 'Popup', 'ContextMenu', 'MenuItem'):
            menu_wins.append((w.window_text(), ctrl, w.element_info.rectangle))
    except:
        pass
print(f"Menu/Popup 窗口: {len(menu_wins)}")
for title, ctrl, rect in menu_wins:
    print(f"  '{title}' ctrl={ctrl} rect={rect}")

# 测试 4: 缓存问题 — 打开菜单后再次扫描
print(f"\n=== 测试 4: 缓存准备 - 扫活动窗口 ===")
for w in all_windows:
    if w.element_info.class_name == 'Notepad':
        print(f"Notepad 子元素:")
        children = w.children()
        print(f"  子元素数: {len(children)}")
        for c in children[:15]:
            ct = c.element_info.control_type
            t = c.window_text() or c.element_info.name or ''
            r = c.element_info.rectangle
            if r.width() > 5 and r.height() > 5:
                print(f"    {ct}: '{t[:30]}' rect=({r.left},{r.top} {r.width()}x{r.height()})")
        break

sys.stdout.flush()
