@echo off
setlocal
cd /d "%~dp0"
if not exist "portable\ContractorPicker.exe" (
  echo The Windows package is incomplete. Get the full submitted project folder.
  echo See README.md for the source-code installation option.
  pause
  exit /b 1
)
"portable\ContractorPicker.exe" %*
if errorlevel 1 (
  echo The application could not start. Read the message above and README.md.
  pause
  exit /b 1
)
