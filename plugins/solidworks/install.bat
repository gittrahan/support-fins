@echo off
rem Registers the Support Fins add-in with SolidWorks (Tools > Add-Ins) and loads it at
rem startup. Run it from the unzipped SupportFins folder, as administrator: COM
rem registration writes to HKEY_LOCAL_MACHINE. Keep the folder where it is afterwards;
rem SolidWorks loads the add-in from here. Restart SolidWorks.
setlocal
net session >nul 2>&1
if errorlevel 1 (
    echo Right-click install.bat and choose "Run as administrator".
    pause
    exit /b 1
)
set "REGASM=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe"
if not exist "%REGASM%" (
    echo .NET Framework 4.8 ^(64-bit^) was not found: %REGASM%
    pause
    exit /b 1
)
"%REGASM%" /codebase /nologo "%~dp0SupportFins.SolidWorks.dll"
if errorlevel 1 (
    echo Registration failed; see the message above.
    pause
    exit /b 1
)
echo Support Fins is installed. Restart SolidWorks; it's under Tools ^> Add-Ins and on a Support Fins tab in parts.
pause
