@echo off
rem Double click this to open the studio.
rem
rem It starts the local editor and opens it in your browser. Keep this black
rem window open while you work; closing it stops the studio. Nothing here is
rem on the internet, it only runs on this machine.
title Griffin studio
cd /d "%~dp0"
call npm run studio
if errorlevel 1 (
  echo.
  echo   Something went wrong. The error is above.
  pause
)
