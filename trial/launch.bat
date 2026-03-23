@echo off
title Race Control Launcher
cd /d "%~dp0"

echo =======================================
echo   Race Control - Starting...
echo =======================================

:: Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH.
    echo Please install Python 3.10+ from https://python.org
    pause
    exit /b 1
)

:: Install dependencies silently if needed
echo Checking dependencies...
pip install -r requirements.txt --quiet --break-system-packages >nul 2>&1
if errorlevel 1 (
    pip install -r requirements.txt --quiet >nul 2>&1
)

:: Start the Python backend in the background
echo Starting backend server...
start /B python camera_test.py

:: Wait a moment for the server to start
timeout /t 2 /nobreak >nul

:: Open browser
echo Opening browser...
start http://localhost:8000

echo.
echo Race Control is running at http://localhost:8000
echo Close this window to stop the server.
echo.

:: Keep the server alive
python camera_test.py
