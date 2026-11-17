@echo off
rem Glow Theme for Online Sequencer - turn on automatic updates on this computer.
rem Adds a task (for you only, no administrator needed) that checks GitHub every hour and when you sign in,
rem and copies a newer version into this folder. Glow Theme then reloads itself. Run "Remove auto-updates.cmd" to stop.
schtasks /Create /F /SC HOURLY /TN "Glow Theme updater" /TR "wscript.exe \"%~dp0run-hidden.vbs\"" >nul
if errorlevel 1 ( echo Couldn't add the update task. & pause & exit /b 1 )
schtasks /Create /F /SC ONLOGON /TN "Glow Theme updater (sign-in)" /TR "wscript.exe \"%~dp0run-hidden.vbs\"" >nul 2>&1
echo Automatic updates are on. Checking for one now...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1"
echo Done. Glow Theme updates itself from now on.
pause
