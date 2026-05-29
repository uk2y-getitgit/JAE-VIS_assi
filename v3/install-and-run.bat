@echo off
chcp 65001 >nul
echo.
echo ========================================
echo  JAE-VIS v2 Prototype - 설치 및 실행
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] 패키지 설치 중...
call npm install
if errorlevel 1 (
  echo.
  echo [오류] npm install 실패. Node.js가 설치되어 있는지 확인하세요.
  pause
  exit /b 1
)

echo.
echo [2/2] 프로토타입 실행 중...
call npm start
