@echo off
chcp 65001 >nul 2>&1
title Deteniendo WhatsApp CRM
color 0C

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║   🔴  Deteniendo WhatsApp CRM ROTAR                 ║
echo  ╚══════════════════════════════════════════════════════╝
echo.

:: Kill node processes running server.js
taskkill /F /IM "node.exe" /FI "WINDOWTITLE eq *WhatsApp*" >nul 2>&1

:: Also try finding by port
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3008 " ^| findstr "LISTENING"') do (
    echo  Deteniendo proceso PID: %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo  ✅ Servidor detenido.
echo.
timeout /t 3 /nobreak >nul
