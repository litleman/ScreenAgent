"""
Screen Agent — 环境健康检查
验证所有依赖和核心功能是否正常
"""

import sys
import importlib
import subprocess
import json

REQUIRED_PIP = [
    ('pywinauto', 'pywinauto'),
    ('PIL', 'Pillow'),
    ('numpy', 'numpy'),
    ('cv2', 'opencv-python'),
    ('easyocr', 'easyocr'),
]

OPTIONAL_PIP = [
    ('pyautogui', 'pyautogui'),
]

NODE_SCRIPTS = {
    'build': 'npm run build',
    'typecheck': 'npx tsc --noEmit',
    'test': 'npx vitest run',
}

pass_count = 0
fail_count = 0


def check(desc: str, ok: bool):
    global pass_count, fail_count
    if ok:
        print(f'  ✅ {desc}')
        pass_count += 1
    else:
        print(f'  ❌ {desc}')
        fail_count += 1


print('=' * 55)
print('  Screen Agent — 环境健康检查')
print('=' * 55)

# ── Python 版本 ──
print('\n📦 Python')
py_ver = f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}'
check(f'Python {py_ver} (需要 >=3.9)', sys.version_info >= (3, 9))

# ── Python 依赖 ──
print('\n📚 Python 依赖')
for mod_name, pip_name in REQUIRED_PIP:
    try:
        m = importlib.import_module(mod_name)
        ver = getattr(m, '__version__', 'ok')
        check(f'{pip_name} ({ver})', True)
    except ImportError:
        check(f'{pip_name} — 未安装', False)

print('\n📚 Python 可选依赖')
for mod_name, pip_name in OPTIONAL_PIP:
    try:
        importlib.import_module(mod_name)
        check(f'{pip_name}', True)
    except ImportError:
        check(f'{pip_name} — 未安装（SendInput 不可用时自动降级）', True)

# ── Node.js ──
print('\n🟢 Node.js')
try:
    r = subprocess.run(['node', '--version'], capture_output=True, text=True, timeout=10)
    check(f'Node.js {r.stdout.strip()}', r.returncode == 0)
except Exception:
    check('Node.js — 未找到', False)

try:
    r = subprocess.run(['npx', '--version'], capture_output=True, text=True, timeout=10)
    check(f'npm/npx 可用', r.returncode == 0)
except Exception:
    check('npm/npx — 未找到', False)

# ── 构建检查 ──
print('\n🔨 TypeScript')
import os
dist_index = os.path.join(os.path.dirname(__file__), '..', 'dist', 'index.js')
check(f'dist/index.js 存在', os.path.isfile(dist_index))

# ── 视觉检查 ──
print('\n👁 视觉引擎')
vision_dir = os.path.join(os.path.dirname(__file__), '..', 'vision')
check(f'vision/omniparser.py 存在', os.path.isfile(os.path.join(vision_dir, 'omniparser.py')))
check(f'vision/uia_bridge.py 存在', os.path.isfile(os.path.join(vision_dir, 'uia_bridge.py')))
check(f'vision/input_engine.py 存在', os.path.isfile(os.path.join(vision_dir, 'input_engine.py')))

# ── UIA 快速测试（不抛异常即可） ──
print('\n🪟 UIA 可访问性')
try:
    import pywinauto
    from pywinauto import Desktop
    desktop = Desktop(backend='uia')
    window = desktop.window()
    focused = window.get_focus()
    check('UIA 可访问性树可扫描', True)
except Exception as e:
    check(f'UIA 扫描失败: {e}', False)

# ── 汇总 ──
print('\n' + '=' * 55)
total = pass_count + fail_count
if fail_count == 0:
    print(f'  ✅ 全部通过 ({pass_count}/{total})')
elif pass_count > 0:
    print(f'  ⚠ {pass_count}/{total} 通过，{fail_count} 项未通过')
else:
    print(f'  ❌ 环境未就绪')
print('=' * 55)

sys.exit(0 if fail_count == 0 else 1)
