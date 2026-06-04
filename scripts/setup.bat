@echo off
chcp 65001 >nul
title Screen Agent — 一键安装
echo ============================================
echo  Screen Agent — 环境安装脚本
echo ============================================
echo.

:: ── 1. 检查 Node.js ──
echo [1/4] 检查 Node.js...
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ Node.js 未安装。请从 https://nodejs.org 下载安装 v18+
    pause
    exit /b 1
)
echo ✅ Node.js 版本:
node -v
echo.

:: ── 2. 检查 Python ──
echo [2/4] 检查 Python...
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ Python 未安装。请从 https://python.org 下载安装 3.9+
    pause
    exit /b 1
)
echo ✅ Python 版本:
python --version
echo.

:: ── 3. 安装 Python 依赖 ──
echo [3/4] 安装 Python 依赖...
pip install -r requirements.txt
if %ERRORLEVEL% neq 0 (
    echo ⚠ pip install 失败，尝试使用 pip3...
    pip3 install -r requirements.txt
)
echo ✅ Python 依赖安装完成
echo.

:: ── 4. 安装 Node.js 依赖 ──
echo [4/4] 安装 Node.js 依赖...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ❌ npm install 失败
    pause
    exit /b 1
)
echo ✅ Node.js 依赖安装完成
echo.

:: ── 构建 ──
echo 🔨 编译 TypeScript...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo ⚠ 编译失败，尝试直接使用 tsx (调试模式)
)
echo.

:: ── 运行检查 ──
echo 🔍 运行健康检查...
python scripts/check.py
echo.

echo ============================================
echo ✅ Screen Agent 安装完成！
echo.
echo 📖 使用方法:
echo   开发模式: npm run dev
echo   生产模式: node dist/index.js
echo.
echo 🔧 MCP 客户端配置:
echo   将 dist/index.js 的路径配置到你的 MCP 客户端中
echo   详见 README.md 的 MCP 配置章节
echo ============================================
pause
