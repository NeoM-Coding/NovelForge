#!/usr/bin/env bash
# NovelForge 个人一键部署脚本
# 用法（服务器上执行）:
#   交互式: curl -fsSL .../deploy.sh | sudo bash
#   非交互: sudo bash deploy.sh --deepseek-key=sk-xxx --db-pass=xxx

set -e

APP_DIR="/www/wwwroot/NovelForge"
REPO_URL="https://github.com/NeoM-Coding/NovelForge.git"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# ── 解析命令行参数 ──
for arg in "$@"; do
  case $arg in
    --deepseek-key=*) DEEPSEEK_KEY="${arg#*=}"; shift ;;
    --embed-key=*)    EMBED_KEY="${arg#*=}"; shift ;;
    --embed-url=*)    EMBED_URL="${arg#*=}"; shift ;;
    --embed-model=*)  EMBED_MODEL="${arg#*=}"; shift ;;
    --db-pass=*)      DB_PASS="${arg#*=}"; shift ;;
  esac
done

# 从 /dev/tty 读取（支持 curl | bash 管道执行）
read_tty() {
  local prompt="$1"
  local var_name="$2"
  local default="${3:-}"
  local value

  if [ -t 0 ]; then
    # 直接执行，stdin 可用
    read -rp "$prompt" value
  else
    # 管道执行，从终端读取
    read -rp "$prompt" value < /dev/tty
  fi

  if [ -n "$default" ] && [ -z "$value" ]; then
    value="$default"
  fi

  eval "$var_name='$value'"
}

echo "╔══════════════════════════════════════════════════╗"
echo "║         NovelForge 个人一键部署脚本              ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ──────────────────────────────────────────────────
# 1. 检查 root
# ──────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}请使用 root 权限运行: sudo bash deploy.sh${NC}"
  exit 1
fi

# ──────────────────────────────────────────────────
# 2. 安装 Docker（如未安装）
# ──────────────────────────────────────────────────
echo "[1/5] 检查 Docker ..."
if ! command -v docker &> /dev/null; then
  echo -e "${YELLOW}Docker 未安装，正在自动安装 ...${NC}"
  curl -fsSL https://get.docker.com | bash
  systemctl enable docker && systemctl start docker
  echo -e "${GREEN}Docker 安装完成${NC}"
else
  echo -e "${GREEN}Docker 已安装${NC}"
fi

if ! docker compose version &> /dev/null; then
  echo -e "${YELLOW}安装 Docker Compose 插件 ...${NC}"
  apt-get update && apt-get install -y docker-compose-plugin
fi

# 检测 Docker Hub 连通性（国内服务器常见超时问题）
echo -n "[1.5/5] 检测 Docker Hub 连通性 ... "
if ! timeout 10 docker pull hello-world &> /dev/null; then
  echo -e "${YELLOW}超时${NC}"
  echo ""
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${RED}⚠️  你的服务器无法访问 Docker Hub 官方源${NC}"
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "国内服务器需要配置 Docker 镜像加速器。执行以下命令："
  echo ""
  echo "  sudo tee /etc/docker/daemon.json <<-'EOF'"
  echo '  {'
  echo '    "registry-mirrors": ['
  echo '      "https://docker.m.daocloud.io",'
  echo '      "https://docker.1panel.live",'
  echo '      "https://hub.rat.dev"'
  echo '    ]'
  echo '  }'
  echo "  EOF"
  echo "  sudo systemctl daemon-reload && sudo systemctl restart docker"
  echo ""
  read_tty "配置完成后按 Enter 继续，或 Ctrl+C 退出: " DUMMY
  if ! timeout 10 docker pull hello-world &> /dev/null; then
    echo -e "${RED}❌ 仍无法访问 Docker Hub，请检查网络或手动配置加速器后再试${NC}"
    exit 1
  fi
  echo -e "${GREEN}加速器配置成功${NC}"
else
  echo -e "${GREEN}正常${NC}"
fi

# ──────────────────────────────────────────────────
# 3. 克隆/更新项目
# ──────────────────────────────────────────────────
echo "[2/5] 拉取项目代码 ..."
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git pull origin master
else
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi
echo -e "${GREEN}代码已就绪${NC}"

# ──────────────────────────────────────────────────
# 4. 配置 .env
# ──────────────────────────────────────────────────
echo "[3/5] 配置环境变量 ..."
if [ -f ".env" ] && [ -z "$DEEPSEEK_KEY" ]; then
  read_tty ".env 已存在，是否重新配置? [y/N]: " RECONF
  if [[ ! "$RECONF" =~ ^[Yy]$ ]]; then
    echo "跳过配置，使用现有 .env"
    CONFIGURE=0
  else
    CONFIGURE=1
  fi
else
  CONFIGURE=1
fi

if [ "$CONFIGURE" = "1" ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "请填写以下配置（均为必填）:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # DeepSeek API Key
  if [ -z "$DEEPSEEK_KEY" ]; then
    while true; do
      read_tty "DeepSeek API Key (以 sk- 开头): " DEEPSEEK_KEY
      if [[ "$DEEPSEEK_KEY" =~ ^sk-.+ ]]; then
        break
      fi
      echo -e "${RED}格式不正确，请以 sk- 开头${NC}"
    done
  fi

  # Embedding API Key
  if [ -z "$EMBED_KEY" ]; then
    read_tty "Embedding API Key [默认使用 DeepSeek Key]: " EMBED_KEY
    EMBED_KEY="${EMBED_KEY:-$DEEPSEEK_KEY}"
  fi

  # Embedding 配置
  if [ -z "$EMBED_URL" ]; then
    read_tty "Embedding 服务地址 [默认 https://dashscope.aliyuncs.com/compatible-mode/v1]: " EMBED_URL
    EMBED_URL="${EMBED_URL:-https://dashscope.aliyuncs.com/compatible-mode/v1}"
  fi

  if [ -z "$EMBED_MODEL" ]; then
    read_tty "Embedding 模型 [默认 text-embedding-v4]: " EMBED_MODEL
    EMBED_MODEL="${EMBED_MODEL:-text-embedding-v4}"
  fi

  # 数据库密码
  if [ -z "$DB_PASS" ]; then
    read_tty "数据库密码 (任意自定义): " DB_PASS
  fi

  # 写入 .env
  cat > .env <<EOF
DATABASE_URL=postgresql://novelforge:${DB_PASS}@db:5432/novelforge
DEEPSEEK_API_KEY=${DEEPSEEK_KEY}
DEEPSEEK_BASE_URL=https://api.deepseek.com
EMBEDDING_BASE_URL=${EMBED_URL}
EMBEDDING_API_KEY=${EMBED_KEY}
EMBEDDING_MODEL=${EMBED_MODEL}
EMBEDDING_DIMENSION=1536
NODE_ENV=production
DB_PASSWORD=${DB_PASS}
EOF

  echo -e "${GREEN}.env 配置已保存${NC}"
fi

# ──────────────────────────────────────────────────
# 5. 启动服务
# ──────────────────────────────────────────────────
echo "[4/5] 启动 NovelForge ..."
mkdir -p uploads backup
docker compose -f docker/docker-compose.image.yml pull 2>/dev/null && \
  docker compose -f docker/docker-compose.image.yml up -d &> /dev/null && \
  echo -e "${GREEN}预构建镜像启动成功${NC}" || {
    echo -e "${YELLOW}预构建镜像不可用，切换到本地构建模式 ...${NC}"
    docker compose -f docker/docker-compose.yml up -d --build
    echo -e "${GREEN}本地构建启动成功${NC}"
  }

# ──────────────────────────────────────────────────
# 6. 等待并显示结果
# ──────────────────────────────────────────────────
echo "[5/5] 等待服务就绪 ..."
sleep 8

IP=$(curl -s -4 ifconfig.me 2>/dev/null || echo "你的服务器IP")

echo ""
echo "══════════════════════════════════════════════════"
echo "  ✅ NovelForge 部署完成！"
echo "══════════════════════════════════════════════════"
echo ""
echo "访问地址:"
echo "  🌐 http://${IP}:3002"
echo "  🔧 http://${IP}:3002/api/health"
echo ""
echo "数据持久化目录:"
echo "  📁 ${APP_DIR}/uploads     (上传文件)"
echo "  📁 ${APP_DIR}/backup      (备份存放)"
echo ""
echo "常用命令:"
echo "  cd ${APP_DIR} && docker compose -f docker/docker-compose.yml logs -f    # 查看日志"
echo "  cd ${APP_DIR} && docker compose -f docker/docker-compose.yml down      # 停止服务"
echo "  cd ${APP_DIR} && docker compose -f docker/docker-compose.yml restart   # 重启服务"
echo ""
echo "如需域名 + SSL，请继续配置 Nginx 反向代理。"
echo ""
