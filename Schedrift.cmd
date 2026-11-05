@echo off
rem Schedrift launcher: double-click to start. Runs locally on http://localhost:5178
setlocal
cd /d "%~dp0"
title Schedrift

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install it from https://nodejs.org and run Schedrift.cmd again.
  pause
  exit /b 1
)

if not exist node_modules\vite (
  echo [schedrift] Installing dependencies ^(first run only^)...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo [schedrift] npm install failed.
    pause
    exit /b 1
  )
)

rem Downloads MPXJ and a portable Java runtime once; quick no-op afterwards.
call node scripts\setup.mjs
if errorlevel 1 echo [schedrift] Continuing without .mpp support. Microsoft Project XML files still work.

call node scripts\ensure-build.mjs
if errorlevel 1 (
  echo [schedrift] Build failed.
  pause
  exit /b 1
)

echo.
echo   Schedrift is starting. Your browser will open automatically.
echo   Keep this window open while you use Schedrift; close it to stop.
echo.
node server\index.mjs --open
if errorlevel 1 pause
