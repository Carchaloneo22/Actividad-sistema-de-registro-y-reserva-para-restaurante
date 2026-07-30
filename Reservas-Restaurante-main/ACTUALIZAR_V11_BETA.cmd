@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0backend"
echo ====================================================
echo ReservaRest V11 - Factura simulada, IVA y propina
echo ====================================================
echo.
call npm.cmd install
if errorlevel 1 goto error
call npm.cmd run migrate:factus
if errorlevel 1 goto error
call npm.cmd run configure:v11-beta
if errorlevel 1 goto error
call npm.cmd run migrate:v11
if errorlevel 1 goto error
call npm.cmd test
if errorlevel 1 goto error
echo.
echo Actualizacion V11 terminada correctamente.
echo Inicia el backend con: npm.cmd run dev
pause
exit /b 0
:error
echo.
echo La actualizacion no pudo completarse. Revisa el mensaje anterior.
pause
exit /b 1
