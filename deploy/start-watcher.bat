@echo off
REM ─── AutoResolve Order Watcher — RDP Startup Script ──────────────────────────
REM Fill in every value below, then double-click this file to start.
REM Keep this window open while automation is running.

REM ── API endpoint ──────────────────────────────────────────────────────────────
set API_BASE=https://refundgod.fans/api/retail
set FORMS_API_KEY=CHANGE_ME

REM ── Telegram (must match values used by the Replit server) ───────────────────
set TELEGRAM_BOT_TOKEN=CHANGE_ME
set TELEGRAM_CHAT_ID=CHANGE_ME

REM ── Dolphin Anty local API (running on the same RDP machine) ─────────────────
set DOLPHIN_LOCAL_API=http://localhost:3001
set DOLPHIN_API_TOKEN=CHANGE_ME
set DOLPHIN_LOCAL_TOKEN=CHANGE_ME
set DOLPHIN_EMAIL=CHANGE_ME
set DOLPHIN_PASSWORD=CHANGE_ME

REM ── SpyderProxy residential credentials ──────────────────────────────────────
set PROXY_USER=CHANGE_ME
set PROXY_PASS=CHANGE_ME
set PROXY_HOST=budget.spyderproxy.com
set PROXY_PORT=11000

REM ── Relay agent (must match RELAY_SECRET in start-relay.bat) ─────────────────
REM The relay runs locally on this RDP at port 4001; do not change RELAY_URL.
set RELAY_URL=http://localhost:4001
set RELAY_SECRET=CHANGE_ME

REM ── Poll interval (seconds between API checks, default 15) ───────────────────
set POLL_INTERVAL=15


REM ─── Clear stale Python env vars ─────────────────────────────────────────────
set PYTHONHOME=
set PYTHONPATH=

REM ─── Detect Python (prefer stable 3.13/3.12/3.11 over pre-release 3.14) ──────
set PYTHON_CMD=

py -3.13 --version >nul 2>nul
if %errorlevel% equ 0 ( set PYTHON_CMD=py -3.13 & goto :python_found )

py -3.12 --version >nul 2>nul
if %errorlevel% equ 0 ( set PYTHON_CMD=py -3.12 & goto :python_found )

py -3.11 --version >nul 2>nul
if %errorlevel% equ 0 ( set PYTHON_CMD=py -3.11 & goto :python_found )

py -3.10 --version >nul 2>nul
if %errorlevel% equ 0 ( set PYTHON_CMD=py -3.10 & goto :python_found )

py --version >nul 2>nul
if %errorlevel% equ 0 ( set PYTHON_CMD=py & goto :python_found )

where python >nul 2>nul
if %errorlevel% equ 0 ( set PYTHON_CMD=python & goto :python_found )

echo ERROR: No Python installation found.
echo Download Python 3.12: https://www.python.org/downloads/release/python-3128/
pause
exit /b 1

:python_found
echo Detected: & %PYTHON_CMD% --version

REM ─── Locate rdp-scripts folder ───────────────────────────────────────────────
set SCRIPTS_DIR=

if exist "%~dp0order_watcher.py"                     set SCRIPTS_DIR=%~dp0
if exist "%~dp0rdp-scripts\order_watcher.py"         set SCRIPTS_DIR=%~dp0rdp-scripts\
if exist "%~dp0deploy\rdp-scripts\order_watcher.py"  set SCRIPTS_DIR=%~dp0deploy\rdp-scripts\

if not "%SCRIPTS_DIR%"=="" goto :scripts_found

echo ERROR: Cannot find order_watcher.py
echo Checked: %~dp0  and  %~dp0rdp-scripts\  and  %~dp0deploy\rdp-scripts\
pause
exit /b 1

:scripts_found
if "%SCRIPTS_DIR:~-1%"=="\" set SCRIPTS_DIR=%SCRIPTS_DIR:~0,-1%
echo Scripts:  %SCRIPTS_DIR%
cd /d "%SCRIPTS_DIR%"

REM ─── Install / upgrade pip ───────────────────────────────────────────────────
echo.
echo [1/3] Upgrading pip...
%PYTHON_CMD% -m ensurepip --upgrade >nul 2>nul
%PYTHON_CMD% -m pip install --upgrade pip --quiet

REM ─── Install packages ────────────────────────────────────────────────────────
echo [2/3] Installing dependencies (httpx, playwright)...

%PYTHON_CMD% -m pip install httpx "playwright>=1.44.0" --quiet
if %errorlevel% neq 0 (
    %PYTHON_CMD% -m pip install httpx playwright --quiet
    if %errorlevel% neq 0 (
        %PYTHON_CMD% -m pip install --pre httpx playwright --quiet
        if %errorlevel% neq 0 (
            echo.
            echo  FAILED: Cannot install packages on Python 3.14.
            echo  Install Python 3.12: https://www.python.org/downloads/release/python-3128/
            echo  Then run this bat file again.
            pause
            exit /b 1
        )
    )
)
echo  Dependencies OK.

REM ─── Install Playwright chromium browser (non-fatal if it fails) ──────────────
echo [3/3] Installing Playwright chromium browser...
%PYTHON_CMD% -m playwright install chromium >nul 2>nul
if %errorlevel% equ 0 (
    echo  Chromium OK.
) else (
    echo  WARNING: Chromium browser install failed.
    echo  The watcher will still start and poll for orders.
    echo  Browser automation will fail until chromium is installed.
    echo  To fix manually, run:  %PYTHON_CMD% -m playwright install chromium
)

echo.
echo ============================================================
echo  AutoResolve Order Watcher — RUNNING
echo  Python:  %PYTHON_CMD%
echo  Scripts: %SCRIPTS_DIR%
echo  API:     %API_BASE%
echo  Relay:   %RELAY_URL%
echo  Poll:    every %POLL_INTERVAL%s
echo  Press Ctrl+C to stop
echo ============================================================
echo.

%PYTHON_CMD% order_watcher.py
pause
