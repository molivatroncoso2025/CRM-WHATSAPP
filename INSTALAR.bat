@echo off
chcp 65001 >nul 2>&1
title ══════ WhatsApp CRM ROTAR - Instalador ══════
color 0A
setlocal enabledelayedexpansion

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║                                                      ║
echo  ║   🟢  WhatsApp CRM - ROTAR                          ║
echo  ║   📦  Instalador Automático para Windows             ║
echo  ║                                                      ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
echo  Este instalador configurará todo lo necesario:
echo    ✓ Node.js (si no está instalado)
echo    ✓ Dependencias del proyecto
echo    ✓ Acceso directo en el Escritorio
echo    ✓ Lanzador rápido
echo.
echo  ───────────────────────────────────────────────────────
pause

:: ─── Step 1: Check Node.js ─────────────────────────────────────────
echo.
echo  [1/4] Verificando Node.js...

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ⚠  Node.js no está instalado.
    echo  📥 Descargando Node.js LTS...
    echo.

    :: Detect architecture
    if "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
        set "NODE_URL=https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi"
        set "NODE_FILE=node-v20.11.1-x64.msi"
    ) else (
        set "NODE_URL=https://nodejs.org/dist/v20.11.1/node-v20.11.1-x86.msi"
        set "NODE_FILE=node-v20.11.1-x86.msi"
    )

    :: Download Node.js
    powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '!NODE_URL!' -OutFile '%TEMP%\!NODE_FILE!' -UseBasicParsing }"

    if not exist "%TEMP%\!NODE_FILE!" (
        echo.
        echo  ❌ Error al descargar Node.js.
        echo  Por favor descarga Node.js manualmente desde: https://nodejs.org
        echo  Luego ejecuta este instalador de nuevo.
        pause
        exit /b 1
    )

    echo  📦 Instalando Node.js (puede pedir permisos de administrador)...
    echo.
    msiexec /i "%TEMP%\!NODE_FILE!" /qn /norestart

    :: Wait for installation
    timeout /t 5 /nobreak >nul

    :: Refresh PATH
    set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm"

    :: Cleanup
    del "%TEMP%\!NODE_FILE!" >nul 2>&1

    :: Verify
    where node >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo  ⚠  Node.js se instaló pero necesita reiniciar la terminal.
        echo  Por favor cierra esta ventana y ejecuta INSTALAR.bat de nuevo.
        pause
        exit /b 1
    )
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo  ✅ Node.js %NODE_VER% detectado
echo.

:: ─── Step 2: Install Dependencies ──────────────────────────────────
echo  [2/4] Instalando dependencias del proyecto...
echo  (esto puede tardar un par de minutos la primera vez)
echo.

cd /d "%~dp0"

:: Use npm.cmd to avoid PowerShell execution policy issues
call npm.cmd install --production 2>nul
if %ERRORLEVEL% NEQ 0 (
    :: Try with full path
    "C:\Program Files\nodejs\npm.cmd" install --production 2>nul
)

if exist "node_modules\express" (
    echo  ✅ Dependencias instaladas correctamente
) else (
    echo  ❌ Error instalando dependencias.
    echo  Intenta ejecutar manualmente: npm install
    pause
    exit /b 1
)
echo.

:: ─── Step 3: Create directories ────────────────────────────────────
echo  [3/4] Creando directorios necesarios...

if not exist "data" mkdir data
if not exist "logs" mkdir logs
if not exist "public\uploads\media" mkdir "public\uploads\media"
if not exist "public\uploads\products" mkdir "public\uploads\products"
if not exist "public\uploads\campaigns" mkdir "public\uploads\campaigns"

echo  ✅ Directorios creados
echo.

:: ─── Step 4: Create Desktop Shortcut ───────────────────────────────
echo  [4/4] Creando acceso directo en el Escritorio...

set "SCRIPT_DIR=%~dp0"
set "DESKTOP=%USERPROFILE%\Desktop"
set "SHORTCUT=%DESKTOP%\WhatsApp CRM ROTAR.lnk"

:: Create shortcut using PowerShell
powershell -Command "& { $ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut('%SHORTCUT%'); $sc.TargetPath = '%SCRIPT_DIR%INICIAR.bat'; $sc.WorkingDirectory = '%SCRIPT_DIR%'; $sc.Description = 'WhatsApp CRM - Administrador de chats ROTAR'; $sc.IconLocation = 'shell32.dll,13'; $sc.Save() }"

if exist "%SHORTCUT%" (
    echo  ✅ Acceso directo creado en el Escritorio
) else (
    echo  ⚠  No se pudo crear el acceso directo automáticamente.
    echo     Puedes usar INICIAR.bat directamente.
)

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║                                                      ║
echo  ║   ✅  INSTALACIÓN COMPLETADA                        ║
echo  ║                                                      ║
echo  ║   Para iniciar el sistema:                           ║
echo  ║   → Doble-clic en "WhatsApp CRM ROTAR"              ║
echo  ║     en tu Escritorio                                 ║
echo  ║   → O ejecuta INICIAR.bat                           ║
echo  ║                                                      ║
echo  ║   La primera vez, escanea el código QR               ║
echo  ║   con tu WhatsApp para conectar.                     ║
echo  ║                                                      ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
echo  ¿Deseas iniciar el sistema ahora? (S/N)
set /p LAUNCH="> "
if /i "%LAUNCH%"=="S" (
    start "" "%~dp0INICIAR.bat"
)

endlocal
exit /b 0
