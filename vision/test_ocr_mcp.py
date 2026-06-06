"""Screen Agent 全面测试 — OCR + MCP 通信"""
import json, sys, time
sys.path.insert(0, r'D:\Administrator\allWorkFiles\桌面视觉代理引擎\screen-agent\vision')

# 测试 OCR
print("=== 测试 5: OmniParser OCR ===")
from omniparser import OmniParser
import numpy as np
from PIL import Image, ImageGrab

screenshot = ImageGrab.grab()
img_np = np.array(screenshot)
parser = OmniParser()
# Check if easyocr works
import easyocr
reader = easyocr.Reader(['ch_sim', 'en'], gpu=False)
results = reader.readtext(img_np)
notepad_texts = [r for r in results if r[1] and ('Notepad' in r[1] or '最终版' in r[1] or '实施计划' in r[1] or '记事本' in r[1] or '文件' in r[1] or '编辑' in r[1] or '查看' in r[1])]
print(f"OCR 总文本块: {len(results)}")
print(f"Notepad 相关文本: {len(notepad_texts)}")
for r in notepad_texts[:10]:
    print(f"  '{r[1]}' conf={r[2]:.2f} at {r[0]}")

# Check menu items specifically
menu_texts = [r for r in results if r[1] and r[1].strip() in ('文件', '编辑', '查看', '格式', '帮助', 'File', 'Edit', 'View', 'Format', 'Help')]
print(f"\n菜单文本 OCR: {len(menu_texts)}")
for r in menu_texts:
    print(f"  '{r[1]}' conf={r[2]:.2f}")

# 测试 6: 缓存与 JSON 输出量
print(f"\n=== 测试 6: JSON 压缩对比 ===")
sample_elements = [
    {"id": "uia_100_200_50_30", "label": "确定", "type": "button", 
     "bounds": {"x": 100, "y": 200, "width": 50, "height": 30},
     "center": {"x": 125, "y": 215},
     "isEnabled": True, "isVisible": True, "isFocused": False,
     "value": None, "className": "Button", "automationId": "1", "source": "uia"},
    {"id": "uia_150_250_100_20", "label": "用户名输入框", "type": "input",
     "bounds": {"x": 150, "y": 250, "width": 100, "height": 20},
     "center": {"x": 200, "y": 260},
     "isEnabled": True, "isVisible": True, "isFocused": True,
     "value": "admin", "className": "Edit", "automationId": "1001", "source": "uia"},
]
pretty = json.dumps({"elements": sample_elements}, indent=2, ensure_ascii=False)
compact = json.dumps({"elements": sample_elements}, ensure_ascii=False)
print(f"Pretty JSON: {len(pretty)} chars / ~{len(pretty)//4} tokens")
print(f"Compact JSON: {len(compact)} chars / ~{len(compact)//4} tokens")
print(f"节省: {((len(pretty)-len(compact))/len(pretty)*100):.0f}%")

# 带缩写
compact_abbr = json.dumps({
    "els": [{"l": e["label"], "t": e["type"], "b": e["bounds"],
             "e": e["isEnabled"], "v": e["isVisible"], "s": e["source"]} 
            for e in sample_elements]
}, ensure_ascii=False)
print(f"缩写 Compact: {len(compact_abbr)} chars / ~{len(compact_abbr)//4} tokens")
print(f"总节省: {((len(pretty)-len(compact_abbr))/len(pretty)*100):.0f}%")

# 测试 7: 输入引擎
print(f"\n=== 测试 7: Input Engine ===")
from input_engine import InputEngine
engine = InputEngine()
info = engine.get_info()
print(f"InputEngine: sendinput={info.get('sendinputAvailable')} pyautogui={info.get('pyautoguiAvailable')}")

sys.stdout.flush()
