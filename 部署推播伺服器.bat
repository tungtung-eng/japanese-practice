@echo off
title Deploy japanese-practice push server
if not exist "%~dp0deploy.ps1" (
  echo.
  echo   deploy.ps1 not found. If you downloaded a ZIP, extract it first.
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1"
echo.
pause
