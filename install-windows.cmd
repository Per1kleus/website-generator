@echo off
setlocal

rem  Website Generator - click to install
rem
rem  Double-click this file. It installs the application on this computer and
rem  adds it to the Start Menu, then offers to start it.
rem
rem  Everything it does is in scripts/install-app.mjs, which is readable and
rem  which drives the same first-launch setup the packaged .exe does. This file
rem  is only here so that nobody has to open a terminal to run it.

title Install Website Generator
cd /d "%~dp0"

if not exist "package.json" (
  echo.
  echo   This file has to stay in the Website Generator folder.
  echo   Move it back next to package.json and try again.
  echo.
  pause
  exit /b 1
)

rem  Node is the one prerequisite. winget is the platform's own package
rem  manager and installs it without an administrator; if it is not there, the
rem  person is told where to get Node rather than left with a silent failure.
where node >/dev/null 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js is needed and was not found.
  echo.
  where winget >/dev/null 2>&1
  if errorlevel 1 (
    echo   Install the LTS version from https://nodejs.org and run this again.
    echo.
    pause
    exit /b 1
  )
  choice /c YN /m "  Install Node.js now with Windows Package Manager"
  if errorlevel 2 (
    echo   Nothing was changed. Install Node.js from https://nodejs.org and run this again.
    echo.
    pause
    exit /b 1
  )
  winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
  rem  winget puts node on the PATH for new processes, not for this one.
  where node >/dev/null 2>&1
  if errorlevel 1 (
    echo.
    echo   Node.js was installed. Close this window and double-click this file again.
    echo.
    pause
    exit /b 0
  )
)

node "scripts\install-app.mjs" %*
set CODE=%ERRORLEVEL%

echo.
if not "%CODE%"=="0" (
  echo   Something did not finish. Nothing has been lost - run this again to carry on.
)
pause
exit /b %CODE%
