@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo VirtualMixDeck をデバッグモードで起動しています...
echo 配信音量まわりのログがこのウィンドウに出力されます。
set VMD_DEBUG=1
call npm start
pause
