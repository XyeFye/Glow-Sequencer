@echo off
rem Glow Theme for Online Sequencer - turn automatic updates off on this computer.
schtasks /Delete /F /TN "Glow Theme updater" >nul 2>&1
schtasks /Delete /F /TN "Glow Theme updater (sign-in)" >nul 2>&1
echo Automatic updates are off.
pause
