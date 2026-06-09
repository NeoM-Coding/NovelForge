@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

:: NovelForge 一键启动脚本 (Windows)
:: 用法: start.bat

set "MODE_DESC=本地构建"

echo ╔══════════════════════════════════════╗
echo ║      NovelForge 一键启动脚本         ║
echo ╚══════════════════════════════════════╝
echo.
echo 部署模式: %MODE_DESC%
echo.

:: 1. 检查 Docker
echo [1/5] 检查 Docker ...
docker --version >nul 2>&1
if errorlevel 1 (
    echo [X] Docker 未安装或未在 PATH 中
    echo 请安装 Docker Desktop: https://docs.docker.com/get-docker/
    pause
    exit /b 1
)
docker info >nul 2>&1
if errorlevel 1 (
    echo [X] Docker 未运行
    echo 请启动 Docker Desktop
    pause
    exit /b 1
)
echo [√] Docker 已就绪

:: 2. 检查 .env
echo [2/5] 检查 .env 配置 ...
if not exist ".env" (
    echo [!] 未找到 .env 文件
    echo.
    echo 请按以下步骤配置：
    echo   1. 复制模板: copy .env.example .env
    echo   2. 编辑 .env，填写你的 API Key
    echo.
    echo 必须填写的项：
    echo   - DEEPSEEK_API_KEY     ^(从 https://platform.deepseek.com/api_keys 获取^)
    echo   - EMBEDDING_API_KEY    ^(从 https://dashscope.console.aliyun.com/apiKey 获取^)
    echo   - DB_PASSWORD          ^(任意自定义密码^)
    echo.
    pause
    exit /b 1
)

findstr /C:"DEEPSEEK_API_KEY=sk-" .env >nul 2>&1
if errorlevel 1 (
    echo [X] DEEPSEEK_API_KEY 未配置或格式不正确
    echo 请编辑 .env 文件，填写有效的 DeepSeek API Key ^(以 sk- 开头^)
    pause
    exit /b 1
)
echo [√] .env 配置已检查

:: 3. 检查 uploads 目录
echo [3/5] 检查数据目录 ...
if not exist "uploads" mkdir uploads
echo [√] 数据目录已就绪

:: 4. 构建并启动
echo [4/5] 启动服务 (%MODE_DESC%) ...
docker compose -f docker/docker-compose.yml up -d --build
if errorlevel 1 (
    echo [X] 启动失败
    echo 请检查上方错误信息
    pause
    exit /b 1
)
echo [√] 服务已启动

:: 5. 等待并确认
echo [5/5] 等待服务就绪 ...
timeout /t 5 /nobreak >nul

curl -s http://localhost:3002/api/health >nul 2>&1
if not errorlevel 1 (
    echo [√] 服务已就绪
    echo.
    echo ═══════════════════════════════════════
    echo   ✅ NovelForge 启动成功！
    echo ═══════════════════════════════════════
    echo.
    echo 访问地址：
    echo   🌐 前端界面: http://localhost:3002
    echo   🔧 健康检查: http://localhost:3002/api/health
    echo   🗄️  数据库:   localhost:15432
    echo.
    echo 常用命令：
    echo   查看日志: docker compose -f docker/docker-compose.yml logs -f app
    echo   停止服务: docker compose -f docker/docker-compose.yml down
    echo   重启服务: docker compose -f docker/docker-compose.yml restart
    echo.
    echo 按任意键在浏览器中打开 ...
    pause >nul
    start http://localhost:3002
) else (
    echo [!] 服务启动中，请稍等 10-30 秒
    echo.
    echo 稍后访问: http://localhost:3002
    echo.
    echo 查看实时日志：
    echo   docker compose -f docker/docker-compose.yml logs -f
    echo.
    pause
)
