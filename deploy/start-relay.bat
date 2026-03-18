@echo off
:: ════════════════════════════════════════════════════════
::  AutoResolve Relay Agent — Startup Script
::  Run this on the RDP machine alongside relay-agent.cjs
::
::  Called from refundgod.fans to control Dolphin Anty locally.
::  Keep this window open while AutoResolve is running.
:: ════════════════════════════════════════════════════════

:: ── Fill in these values ─────────────────────────────────
set DOLPHIN_API_TOKEN=PASTE_YOUR_DOLPHIN_JWT_HERE
set RELAY_SECRET=CHANGE_ME_random_relay_secret
set TWOCAPTCHA_API_KEY=065565f0aba0ac28620f1e40f530a20b
set PROXY_HOST=residential.spyderproxy.com
set PROXY_PORT=7777
set PROXY_TYPE=socks5
set PROXY_USER=PASTE_YOUR_PROXY_USERNAME
set PROXY_PASS=PASTE_YOUR_PROXY_PASSWORD
set RELAY_PORT=4001
:: ─────────────────────────────────────────────────────────

:: Check Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed.
    echo Download it from https://nodejs.org and install it first.
    pause
    exit /b 1
)

:: Check relay-agent.cjs is in the same folder
if not exist "%~dp0relay-agent.cjs" (
    echo ERROR: relay-agent.cjs not found next to this script.
    echo Make sure both files are in the same folder.
    pause
    exit /b 1
)

echo.
echo  Starting AutoResolve Relay Agent...
echo  Calls from refundgod.fans will be relayed to Dolphin Anty.
echo.
echo  IMPORTANT: Keep Dolphin Anty open while this is running.
echo  Press Ctrl+C to stop the relay.
echo.

node "%~dp0relay-agent.cjs"
pause
