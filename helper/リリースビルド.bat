@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo VirtualMixDeck.Helper をリリース用（自己完結・単一exe）でビルドしています...
dotnet publish -c Release
echo.
echo 完了しました。出力先: bin\Release\net10.0-windows\win-x64\publish\VirtualMixDeck.Helper.exe
pause
