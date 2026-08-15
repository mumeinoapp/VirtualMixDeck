@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo VirtualMixDeck.Helper をビルドしています...
dotnet build
pause
