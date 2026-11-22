@echo off
cd /d "%~dp0"
title National Industrial Initiatives Platform

echo ======================================================================
echo    Arab Republic of Egypt - Ministry of Industry
echo    National Industrial Initiatives Platform
echo ======================================================================
echo.
echo Starts the backend (with MySQL in Docker) in a second window, then the frontend here.
echo.

start "Backend :5000" cmd /c "%~dp0RUN_BACKEND.bat"

if not exist frontend\node_modules (
  echo Installing frontend packages...
  cd frontend
  call npm install
  if errorlevel 1 goto ON_ERROR
  cd /d "%~dp0"
)

echo Frontend: http://localhost:5173  (the API is proxied to http://localhost:5000)
cd frontend
call npm run dev -- --open
if errorlevel 1 goto ON_ERROR
goto DONE

:ON_ERROR
echo.
echo [ERROR] Failed to run the platform.
pause
exit /b 1

:DONE
pause
