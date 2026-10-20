@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Chyba: nie je nainstalovany Node.js. Stiahni ho z https://nodejs.org ^(verzia LTS^) a spusti tento subor znova. & pause & exit /b 1)
if not exist node_modules (echo Instalujem kniznice, prvykrat to chvilu trva... & call npm install || (pause & exit /b 1))
if not exist dist\index.html (echo Pripravujem aplikaciu... & call npm run build || (pause & exit /b 1))
start "" http://localhost:8080
node server\server.js
pause
