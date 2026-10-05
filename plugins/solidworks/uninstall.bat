@echo off
rem Removes the Support Fins add-in from SolidWorks. Run as administrator, then delete the
rem folder. Fins already inserted into parts stay: they are ordinary imported bodies.
setlocal
net session >nul 2>&1
if errorlevel 1 (
    echo Right-click uninstall.bat and choose "Run as administrator".
    pause
    exit /b 1
)
set "REGASM=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe"
if not exist "%REGASM%" (
    echo .NET Framework 4.8 ^(64-bit^) was not found: %REGASM%
    pause
    exit /b 1
)
"%REGASM%" /unregister /nologo "%~dp0SupportFins.SolidWorks.dll"
if errorlevel 1 (
    echo Unregistering failed; see the message above.
    pause
    exit /b 1
)
echo Support Fins is uninstalled. Restart SolidWorks, then delete this folder.
pause
