@echo off
:: Enable Teredo Native IPv6 for Windows
:: This script automatically requests Administrator privileges to modify network adapters

:: Check for Administrative privileges
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo Requesting Administrative Privileges to enable Native IPv6...
    goto UACPrompt
) else ( goto gotAdmin )

:UACPrompt
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    set params= %*
    echo UAC.ShellExecute "cmd.exe", "/c ""%~s0"" %params:"=""%", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs"
    del "%temp%\getadmin.vbs"
    exit /B

:gotAdmin
    pushd "%CD%"
    CD /D "%~dp0"

echo [System] Administrative privileges acquired.
echo [Teredo] Disabling legacy offline configurations...
netsh interface teredo set state disable
timeout /t 2 >nul

echo [Teredo] Enabling Enterprise Native IPv6 Tunnel...
netsh interface ipv6 set teredo client teredo.trex.fi
netsh interface teredo set state type=enterpriseclient

echo [Teredo] Restarting IP Helper service...
net stop iphlpsvc
net start iphlpsvc

echo [System] Waiting 5 seconds for IPv6 negotiation...
timeout /t 5 >nul

echo [Status] Current IPv6 Teredo State:
netsh interface teredo show state

echo.
echo ========================================================
echo ✅ Teredo Native IPv6 successfully injected into OS!
echo 👉 You can now open https://test-ipv6.com/ in your browser.
echo 👉 The registration machine will natively use this IPv6!
echo ========================================================
pause
exit
