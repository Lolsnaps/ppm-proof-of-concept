@echo off
REM ---------------------------------------------------------------------------
REM  Portfolio Manager - version stamp updater
REM
REM  Double-click this after changing any .js or .css file. It rewrites the ?v=
REM  tag on every reference in every page, so browsers stop serving cached
REM  copies of files you have just changed.
REM
REM  Was a PowerShell script until 9 August 2026. Now node, like every other
REM  tool in this folder, so the same code can be run and checked anywhere.
REM  See the header of BUMP-VERSION.mjs.
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
node BUMP-VERSION.mjs
echo.
pause
