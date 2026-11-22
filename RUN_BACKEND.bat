@echo off
cd /d "%~dp0"
title Industrial Initiatives Platform - Backend :5000
echo Starting MySQL (Docker, 127.0.0.1:3306)...
docker compose -f docker-compose.dev.yml up -d mysql
if errorlevel 1 (
  echo [ERROR] Docker is required for the database. Start Docker Desktop and run again.
  pause
  exit /b 1
)
cd backend
if not exist node_modules (
  echo Installing backend packages...
  call npm install
  if errorlevel 1 goto ON_ERROR
)
rem Demo accounts of the platform and of every initiative on an empty database (password Mobadrat@2026).
if not exist .env set SEED_ON_BOOT=1
if not exist .env set REGISTRY_ADAPTER=mock
echo Backend API: http://localhost:5000/health
call npm run dev
if errorlevel 1 goto ON_ERROR
goto DONE
:ON_ERROR
echo.
echo [ERROR] Backend failed to start.
pause
exit /b 1
:DONE
pause
