@echo off
setlocal
cd /d "%~dp0backend"
echo.
echo ==============================================
echo  ReservaRest V10 - Actualizacion Factus
echo ==============================================
echo.
if not exist .env (
  echo ERROR: No existe backend\.env.
  echo Copie .env.example como .env y configure MySQL y Factus.
  pause
  exit /b 1
)
call npm.cmd install
if errorlevel 1 goto :error
call npm.cmd run migrate:factus
if errorlevel 1 goto :error
call npm.cmd test
if errorlevel 1 goto :error
echo.
echo Actualizacion y pruebas completadas.
echo Ahora ejecute: npm.cmd run dev
pause
exit /b 0
:error
echo.
echo La actualizacion se detuvo por un error. Revise el mensaje anterior.
pause
exit /b 1
