@echo off
setlocal
cd /d "%~dp0backend"
echo.
echo === Instalando y actualizando dependencias ===
call npm.cmd install
if errorlevel 1 goto :error

echo.
echo === Ejecutando pruebas generales ===
call npm.cmd test
if errorlevel 1 goto :error

echo.
echo === Ejecutando pruebas de seguridad ===
call npm.cmd run test:security
if errorlevel 1 goto :error

echo.
echo === Revisando dependencias de produccion ===
call npm.cmd run audit:production
if errorlevel 1 goto :auditwarning

echo.
echo Validacion terminada correctamente.
pause
exit /b 0

:auditwarning
echo.
echo Las pruebas pasaron, pero npm audit encontro elementos que deben revisarse.
echo No ejecutes npm audit fix --force sin probar primero el sistema.
pause
exit /b 1

:error
echo.
echo La validacion se detuvo por un error. Copia el mensaje de esta ventana para revisarlo.
pause
exit /b 1
