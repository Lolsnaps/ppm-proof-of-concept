@echo off
REM ---------------------------------------------------------------------------
REM  Portfolio Manager - publish the hosted site
REM
REM  This folder is the private source: the application, the migrations, the
REM  documentation, the harness and the build tooling. The hosted site is served
REM  from a separate public repository that gets only the files a browser
REM  actually asks for: the pages, the CSS and the JavaScript.
REM
REM  That public copy lives BESIDE this folder, at ..\ppm-proof-of-concept, because
REM  GitHub Desktop cannot manage a repository that sits inside another one.
REM
REM  Double-click this file after making changes. It will:
REM
REM      1. run every release gate, and stop if one fails
REM      2. refresh ..\ppm-proof-of-concept so it holds exactly that set, and nothing else
REM      3. show you what changed and what to click to publish it
REM
REM  It never commits and never pushes on your behalf. See
REM  PRIVATE-AND-PUBLIC-REPOS.md for the one-off setup.
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-public.ps1"
