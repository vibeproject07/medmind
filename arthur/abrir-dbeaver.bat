@echo off
echo ========================================
echo   Localizacao do Banco de Dados
echo ========================================
echo.
echo Caminho completo do banco:
echo %CD%\medmind.db
echo.
echo Para conectar no DBeaver:
echo 1. Abra o DBeaver
echo 2. Nova Conexao -^> SQLite
echo 3. Path: %CD%\medmind.db
echo 4. Test Connection
echo 5. Finish
echo.
echo Pressione qualquer tecla para abrir o explorador de arquivos...
pause >nul
explorer /select,"%CD%\medmind.db"
