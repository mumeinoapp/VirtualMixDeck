@echo off
cd /d "%~dp0..\app"
echo Installing Wave Link client library (@raphiiko/wavelink-ts)...
call npm install
if errorlevel 1 (
  echo.
  echo npm install failed. See errors above.
  pause
  exit /b 1
)

echo.
echo Make sure Elgato Wave Link is running, then press any key to continue.
pause
echo.
echo Running connection test script...
node "%~dp0wavelink-connect-test.js"
echo.
echo Done. Please check the output above.
pause
