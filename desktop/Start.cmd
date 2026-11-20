@echo off
setlocal
"%~dp0runtime\python.exe" "%~dp0desktop.py"
if errorlevel 1 pause
