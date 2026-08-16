@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo VirtualMixDeck の配布用インストーラーをビルドしています...
call npm run build
if errorlevel 1 (
    echo.
    echo ビルドに失敗しました。上記のエラー内容を確認してください。
    pause
    exit /b 1
)
echo.
echo ビルドが完了しました。release フォルダ内に VirtualMixDeck-Setup-*.exe が生成されています。
pause
