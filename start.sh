#!/usr/bin/env bash
# NovelForge 一键启动脚本 (Linux / macOS / WSL)
# 用法: ./start.sh [image|build]
#   image (默认, 预构建镜像) | build (本地编译)

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 默认使用预构建镜像
MODE="${1:-image}"
COMPOSE_FILE="docker/docker-compose.image.yml"
BUILD_FLAG=""

if [ "$MODE" = "build" ]; then
    COMPOSE_FILE="docker/docker-compose.yml"
    BUILD_FLAG="--build"
    MODE_DESC="本地构建"
else
    MODE_DESC="预构建镜像"
fi

echo "╔══════════════════════════════════════╗"
echo "║      NovelForge 一键启动脚本         ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo -e "部署模式: ${BLUE}${MODE_DESC}${NC}"
echo ""

# 1. 检查 Docker
echo -n "[1/5] 检查 Docker ... "
if ! command -v docker &> /dev/null; then
    echo -e "${RED}未安装${NC}"
    echo "请安装 Docker Desktop: https://docs.docker.com/get-docker/"
    exit 1
fi
if ! docker info &> /dev/null; then
    echo -e "${RED}Docker 未运行${NC}"
    echo "请启动 Docker Desktop"
    exit 1
fi
echo -e "${GREEN}OK${NC}"

# 2. 检查 .env
echo -n "[2/5] 检查 .env 配置 ... "
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}未找到${NC}"
    echo ""
    echo "请按以下步骤配置："
    echo "  1. 复制模板: cp .env.example .env"
    echo "  2. 编辑 .env，填写你的 API Key"
    echo ""
    echo "必须填写的项："
    echo "  - DEEPSEEK_API_KEY     (从 https://platform.deepseek.com/api_keys 获取)"
    echo "  - EMBEDDING_API_KEY    (从 https://dashscope.console.aliyun.com/apiKey 获取，或使用 OpenAI)"
    echo "  - DB_PASSWORD          (任意自定义密码)"
    echo ""
    exit 1
fi

# 检查关键配置
if ! grep -q "DEEPSEEK_API_KEY=sk-" .env 2>/dev/null; then
    echo -e "${RED}DEEPSEEK_API_KEY 未配置${NC}"
    echo "请编辑 .env 文件，填写有效的 DeepSeek API Key"
    exit 1
fi

if ! grep -q "EMBEDDING_API_KEY=sk-" .env 2>/dev/null && ! grep -q "EMBEDDING_API_KEY=" .env 2>/dev/null | grep -qv "EMBEDDING_API_KEY=$"; then
    echo -e "${YELLOW}警告: EMBEDDING_API_KEY 可能未配置${NC}"
fi
echo -e "${GREEN}OK${NC}"

# 3. 检查 uploads 目录
echo -n "[3/5] 检查数据目录 ... "
mkdir -p uploads
echo -e "${GREEN}OK${NC}"

# 4. 拉取镜像 / 构建并启动
echo -n "[4/5] 启动服务 (${MODE_DESC}) ... "
if [ "$MODE" = "image" ]; then
    docker compose -f "$COMPOSE_FILE" pull > /tmp/novelforge-start.log 2>&1
fi
docker compose -f "$COMPOSE_FILE" up -d $BUILD_FLAG >> /tmp/novelforge-start.log 2>&1
if [ $? -ne 0 ]; then
    echo -e "${RED}失败${NC}"
    echo ""
    echo "可能原因："
    if [ "$MODE" = "image" ]; then
        echo "  1. 预构建镜像尚未生成（GitHub Actions 未运行）"
        echo "  2. GitHub Packages 未设为公开"
        echo ""
        echo -e "可尝试本地构建: ${YELLOW}./start.sh build${NC}"
    fi
    echo ""
    echo "详细日志:"
    cat /tmp/novelforge-start.log
    exit 1
fi
echo -e "${GREEN}OK${NC}"

# 5. 等待并确认
echo -n "[5/5] 等待服务就绪 ... "
sleep 5
if curl -s http://localhost:3002/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}OK${NC}"
    echo ""
    echo -e "${GREEN}✅ NovelForge 启动成功！${NC}"
    echo ""
    echo "访问地址:"
    echo "  🌐 前端界面: http://localhost:3002"
    echo "  🔧 健康检查: http://localhost:3002/api/health"
    echo "  🗄️  数据库:   localhost:15432 (PostgreSQL + pgvector)"
    echo ""
    echo "常用命令:"
    echo "  查看日志: docker compose -f ${COMPOSE_FILE} logs -f app"
    echo "  停止服务: docker compose -f ${COMPOSE_FILE} down"
    echo "  重启服务: docker compose -f ${COMPOSE_FILE} restart"
    echo ""
else
    echo -e "${YELLOW}服务启动中，请稍等 10-30 秒${NC}"
    echo ""
    echo "等待数据库初始化完成，稍后访问: http://localhost:3002"
    echo ""
    echo "查看实时日志:"
    echo "  docker compose -f ${COMPOSE_FILE} logs -f"
fi
