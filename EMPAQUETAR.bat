@echo off
chcp 65001 >nul 2>&1
title Empaquetando WhatsApp CRM ROTAR
color 0B
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║                                                      ║
echo  ║   📦  Empaquetando WhatsApp CRM ROTAR                ║
echo  ║   Creando paquete portable para distribución         ║
echo  ║                                                      ║
echo  ╚══════════════════════════════════════════════════════╝
echo.

set "OUTPUT_DIR=%USERPROFILE%\Desktop"
set "ZIP_NAME=WhatsApp-CRM-ROTAR"
set "TEMP_DIR=%TEMP%\%ZIP_NAME%"

:: Clean temp
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
mkdir "%TEMP_DIR%"

echo  📋 Copiando archivos del proyecto...

:: Copy project files (excluding node_modules, data, logs, .wwebjs_cache)
xcopy /E /I /Q /Y "public" "%TEMP_DIR%\public" >nul
copy /Y "server.js" "%TEMP_DIR%\" >nul
copy /Y "whatsapp.js" "%TEMP_DIR%\" >nul
copy /Y "database.js" "%TEMP_DIR%\" >nul
copy /Y "package.json" "%TEMP_DIR%\" >nul
copy /Y "package-lock.json" "%TEMP_DIR%\" >nul
copy /Y "INSTALAR.bat" "%TEMP_DIR%\" >nul
copy /Y "INICIAR.bat" "%TEMP_DIR%\" >nul
copy /Y "DETENER.bat" "%TEMP_DIR%\" >nul
copy /Y "README.md" "%TEMP_DIR%\" >nul
copy /Y ".gitignore" "%TEMP_DIR%\" >nul 2>nul

:: Remove any user data from uploads
if exist "%TEMP_DIR%\public\uploads\media\*" del /q "%TEMP_DIR%\public\uploads\media\*" >nul 2>nul
if exist "%TEMP_DIR%\public\uploads\products\*" del /q "%TEMP_DIR%\public\uploads\products\*" >nul 2>nul

echo  ✅ Archivos copiados
echo.
echo  📦 Comprimiendo en ZIP...

:: Create ZIP using PowerShell
if exist "%OUTPUT_DIR%\%ZIP_NAME%.zip" del "%OUTPUT_DIR%\%ZIP_NAME%.zip"
powershell -Command "Compress-Archive -Path '%TEMP_DIR%\*' -DestinationPath '%OUTPUT_DIR%\%ZIP_NAME%.zip' -Force"

:: Cleanup temp
rmdir /s /q "%TEMP_DIR%" >nul 2>&1

if exist "%OUTPUT_DIR%\%ZIP_NAME%.zip" (
    echo.
    echo  ╔══════════════════════════════════════════════════════╗
    echo  ║                                                      ║
    echo  ║   ✅  PAQUETE CREADO EXITOSAMENTE                   ║
    echo  ║                                                      ║
    echo  ║   📁 Ubicación:                                      ║
    echo  ║   %OUTPUT_DIR%\%ZIP_NAME%.zip
    echo  ║                                                      ║
    echo  ║   📋 Instrucciones para el usuario:                  ║
    echo  ║   1. Descomprimir el ZIP en cualquier carpeta        ║
    echo  ║   2. Doble-clic en INSTALAR.bat                      ║
    echo  ║   3. Listo!                                          ║
    echo  ║                                                      ║
    echo  ╚══════════════════════════════════════════════════════╝
) else (
    echo  ❌ Error al crear el ZIP.
)
echo.
pause
