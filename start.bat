@echo off
chcp 65001 >nul
title LectorVoz Pro - Servidor Local
echo ================================================================
echo           Iniciando LectorVoz Pro en tu navegador...
echo ================================================================
echo.

cd /d "%~dp0"

where python >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Python detectado.
    echo [OK] Levantando servidor local en http://localhost:8080 ...
    echo.
    echo Para cerrar la aplicacion, simplemente cierra esta ventana.
    echo.
    start "" http://localhost:8080/index.html
    python server.py
) else (
    echo [AVISO] Python no detectado en el PATH.
    echo Abriendo directamente index.html en tu navegador predeterminado...
    start "" "%~dp0index.html"
)
