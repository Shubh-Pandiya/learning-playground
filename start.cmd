@echo off
rem Windows: start Learning Playground at http://localhost:5199 (installs deps on first run).
cd /d "%~dp0"
where npm >nul 2>nul || (echo Node.js not found. Install Node 20.19+ or 22.12+ from https://nodejs.org & exit /b 1)
npm start
