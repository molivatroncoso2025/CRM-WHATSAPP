@echo off
chcp 65001 >nul 2>&1
title 🟢 WhatsApp CRM ROTAR
color 0A
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║                                                      ║
echo  ║   🟢  WhatsApp CRM - ROTAR                          ║
echo  ║   🚀  Iniciando sistema...                           ║
echo  ║                                                      ║
echo  ╚══════════════════════════════════════════════════════╝
echo.

:: ─── Check Node.js ─────────────────────────────────────────────────
set "NODE_CMD=node"
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "NODE_CMD=C:\Program Files\nodejs\node.exe"
        set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm"
    ) else (
        echo  ❌ Node.js no encontrado.
        echo  Ejecuta INSTALAR.bat primero.
        pause
        exit /b 1
    )
)

:: ─── Check Dependencies ───────────────────────────────────────────
if not exist "node_modules\express" (
    echo  📦 Instalando dependencias...
    call npm.cmd install --production 2>nul
    if not exist "node_modules\express" (
        "C:\Program Files\nodejs\npm.cmd" install --production 2>nul
    )
)

:: ─── Check if already running ──────────────────────────────────────
set "PORT=3008"
netstat -aon | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo  ⚠  El puerto %PORT% ya está en uso.
    echo  El sistema podría estar corriendo ya.
    echo.
    echo  Abriendo navegador...
    timeout /t 2 /nobreak >nul
    start "" "http://localhost:%PORT%"
    exit /b 0
)

:: ─── Create PID file for stop script ───────────────────────────────
echo.
echo  ✅ Iniciando servidor en puerto %PORT%...
echo  📱 Abre tu navegador en: http://localhost:%PORT%
echo.
echo  ───────────────────────────────────────────────────────
echo  Para detener: cierra esta ventana o ejecuta DETENER.bat
echo  ───────────────────────────────────────────────────────
echo.

:: ─── Wait a moment then open browser ──────────────────────────────
start /b cmd /c "timeout /t 4 /nobreak >nul && start "" http://localhost:%PORT%"

:: ─── Start server (stays in foreground) ────────────────────────────
"%NODE_CMD%" server.js

echo.
echo  🔴 Servidor detenido.
pause
