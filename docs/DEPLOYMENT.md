# NovelForge 部署手册

> 适用环境：Windows 本地（PowerShell）+ 宝塔面板服务器（Docker）
> 部署方式：本地预构建 Docker 镜像 → 导出 tar → 宝塔上传 → 服务器导入运行

---

## 1. 前置条件

### 1.1 本地环境（Windows）

| 依赖 | 验证命令 | 安装方式 |
|------|---------|---------|
| Docker Desktop | `docker --version` | [官网下载](https://www.docker.com/products/docker-desktop) |
| Git | `git --version` | [官网下载](https://git-scm.com/download/win) |
| PowerShell 5.1+ | `$PSVersionTable.PSVersion` | Windows 自带 |
| OpenSSH 客户端 | `scp` | `设置 → 应用 → 可选功能 → OpenSSH 客户端` |

### 1.2 服务器环境（宝塔）

| 依赖 | 验证命令 | 安装方式 |
|------|---------|---------|
| Docker | `docker --version` | 宝塔面板 → 软件商店 → Docker管理器 |
| Git | `git --version` | `yum install git` / `apt install git` |

### 1.3 端口规划

在宝塔面板 → **安全** → **防火墙** 中放行：

| 端口 | 用途 | 是否必需 |
|------|------|---------|
| `8086` | NovelForge 应用 | ✅ |
| `15432` | PostgreSQL 数据库 | 可选（外部连接时需要） |

---

## 2. 项目结构说明

```
NovelForge/
├── docker/
│   ├── Dockerfile                    # 镜像构建定义
│   ├── docker-compose.yml            # 本地构建版（服务器编译）
│   ├── docker-compose.image.yml      # 预构建镜像版（GitHub拉取）
│   ├── docker-compose.local.yml      # 本地预构建版（tar导入）⭐ 本方案使用
│   ├── nginx.conf                    # Nginx 反向代理配置
│   ├── deploy.sh                     # 服务器一键部署脚本
│   └── .dockerignore                 # 构建忽略规则
├── docs/                             # 文档目录
├── src/                              # 前端源码
├── api/                              # 后端源码
├── db/                               # 数据库 schema
├── contracts/                        # 共享契约
├── public/                           # 静态资源
├── .env.example                      # 环境变量模板
├── package.json                      # Node.js 依赖
└── ...
```

---

## 3. 首次部署

### 3.1 本地构建并导出镜像

在 **Windows PowerShell** 中执行：

```powershell
# 进入项目目录
cd E:\你的\项目\路径\NovelForge

# 拉取最新代码（如需要）
git pull origin master

# 构建镜像
docker build -f docker/Dockerfile -t novelforge:latest .

# 导出为 tar（必须使用 -o 参数，PowerShell 的 > 会破坏二进制文件）
docker save -o novelforge.tar novelforge:latest

# 确认文件
Get-Item novelforge.tar | Select-Object Name, @{Name="SizeMB";Expression={[math]::Round($_.Length/1MB,2)}}
```

**输出示例：**
```
Name           SizeMB
----           ------
novelforge.tar 892.45
```

### 3.2 上传到服务器

**方式一：宝塔文件管理器（推荐）**

1. 登录宝塔面板 → **文件**
2. 进入 `/www/wwwroot/`
3. 如不存在 `NovelForge` 文件夹，点击 **新建目录**
4. 进入 `NovelForge` 文件夹，点击 **上传** → 选择 `novelforge.tar`

**方式二：PowerShell scp（可选）**

```powershell
scp novelforge.tar root@你的服务器IP:/www/wwwroot/NovelForge/
```

### 3.3 服务器导入并启动

在宝塔面板 → **终端** 中执行：

```bash
# 1. 进入目录
cd /www/wwwroot/NovelForge

# 2. 克隆仓库（如尚未克隆）
git clone https://github.com/NeoM-Coding/NovelForge.git .

# 3. 复制环境配置
cp .env.example .env
nano .env    # 或 vim .env
```

`.env` 必填项：

```env
DATABASE_URL=postgresql://novelforge:你的数据库密码@db:5432/novelforge
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
DEEPSEEK_BASE_URL=https://api.deepseek.com
EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
EMBEDDING_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIMENSION=1536
NODE_ENV=production
DB_PASSWORD=你的数据库密码
```

```bash
# 4. 导入镜像
docker load -i novelforge.tar

# 5. 确认镜像
docker images | grep novelforge

# 6. 启动服务
docker compose -f docker/docker-compose.local.yml up -d

# 7. 查看日志
docker compose -f docker/docker-compose.local.yml logs -f
```

### 3.4 验证部署

```bash
# 检查所有容器状态
docker compose -f docker/docker-compose.local.yml ps

# 健康检查
curl http://localhost:8086/api/health
```

浏览器访问：`http://你的服务器IP:8086`

---

## 4. 日常更新流程（可复用）

### 4.1 核心原则

| 原则 | 说明 |
|------|------|
| **只更新 app 容器** | 数据库容器不动，数据不丢 |
| **保留 volume** | `pgdata` 是 named volume，默认不会被删除 |
| **禁用 `-v` 参数** | `docker compose down -v` 会强制删除 volume，数据清零 |

### 4.2 更新步骤

**Step 1：本地构建（PowerShell）**

```powershell
cd E:\你的\项目\路径\NovelForge

git pull origin master
docker build -f docker/Dockerfile -t novelforge:latest .
docker save -o novelforge.tar novelforge:latest
```

**Step 2：上传（宝塔文件管理器）**

1. 宝塔 → 文件 → `/www/wwwroot/NovelForge/`
2. 上传新的 `novelforge.tar`（覆盖旧文件）
3. 如 `docker-compose.local.yml` 有更新，同步上传

**Step 3：服务器更新（宝塔终端）**

```bash
cd /www/wwwroot/NovelForge

# 拉取最新 compose 配置（如有更新）
git pull origin master

# 导入新镜像
docker load -i novelforge.tar

# 重启服务（compose 检测到 app 镜像变化，自动重建 app 容器；db 容器保持不动）
docker compose -f docker/docker-compose.local.yml up -d

# 清理旧镜像（释放空间，可选）
docker image prune -f

# 确认状态
docker compose -f docker/docker-compose.local.yml ps
```

### 4.3 更新流程图示

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  本地构建    │ ──▶ │  导出 tar    │ ──▶ │  宝塔上传    │
│ docker build │     │ docker save  │     │  文件管理器  │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
┌──────────────┐     ┌──────────────┐     ┌──────▼───────┐
│  确认状态    │ ◀── │  重启服务    │ ◀── │  服务器导入  │
│  docker ps   │     │  compose up  │     │  docker load │
└──────────────┘     └──────────────┘     └──────────────┘
```

---

## 5. 自动化脚本

### 5.1 本地构建脚本（PowerShell）

保存为 `build.ps1`，放在项目根目录：

```powershell
# build.ps1 — 本地构建并导出镜像
param(
    [string]$Tag = "novelforge:latest"
)

$ErrorActionPreference = "Stop"

Write-Host "🔨 构建镜像 $Tag ..." -ForegroundColor Cyan
docker build -f docker/Dockerfile -t $Tag .
if ($LASTEXITCODE -ne 0) { throw "构建失败" }

Write-Host "💾 导出镜像 ..." -ForegroundColor Cyan
docker save -o novelforge.tar $Tag

$size = [math]::Round((Get-Item novelforge.tar).Length / 1MB, 2)
Write-Host "✅ 完成！文件: novelforge.tar ($size MB)" -ForegroundColor Green
```

**使用：**

```powershell
.\build.ps1
```

### 5.2 服务器更新脚本（Bash）

保存为 `update.sh`，放在 `/www/wwwroot/NovelForge/`：

```bash
#!/bin/bash
# update.sh — 服务器端导入新镜像并更新
set -e

COMPOSE_FILE="docker/docker-compose.local.yml"

echo "📥 导入镜像 ..."
docker load -i novelforge.tar

echo "🚀 重启服务 ..."
docker compose -f $COMPOSE_FILE up -d

echo "🧹 清理旧镜像 ..."
docker image prune -f

echo "📊 当前状态："
docker compose -f $COMPOSE_FILE ps

echo "✅ 更新完成！"
```

**使用：**

```bash
chmod +x update.sh
./update.sh
```

---

## 6. 数据管理

### 6.1 数据库数据持久化机制

PostgreSQL 数据存储在 Docker **named volume** `pgdata` 中：

```yaml
# docker-compose.local.yml
volumes:
  pgdata:        # ← 这个 volume 存储所有数据库文件
```

**特性：**
- `docker compose up/down` **不会**删除 named volume
- 只有 `docker compose down -v` 或 `docker volume rm` 才会删除
- 即使删除容器重建，volume 会自动重新挂载

### 6.2 备份数据库（建议定期执行）

```bash
cd /www/wwwroot/NovelForge

# 导出数据库为 SQL
docker compose -f docker/docker-compose.local.yml exec db pg_dump -U novelforge novelforge > backup/novelforge_$(date +%Y%m%d_%H%M%S).sql

# 或备份整个 volume
docker run --rm -v novel-forge_pgdata:/source -v $(pwd)/backup:/backup alpine tar czf /backup/pgdata_$(date +%Y%m%d_%H%M%S).tar.gz -C /source .
```

### 6.3 恢复数据库

```bash
# 从 SQL 恢复
docker compose -f docker/docker-compose.local.yml exec -T db psql -U novelforge novelforge < backup/novelforge_xxxx.sql
```

---

## 7. 故障排查

### 7.1 容器启动失败

```bash
# 查看详细日志
docker compose -f docker/docker-compose.local.yml logs -f app

# 查看数据库日志
docker compose -f docker/docker-compose.local.yml logs -f db
```

### 7.2 镜像导入失败

```bash
# 检查 tar 文件完整性
docker load -i novelforge.tar

# 如损坏，重新从本地导出上传
```

### 7.3 端口被占用

```bash
# 查看端口占用
netstat -tlnp | grep 8086

# 修改 docker-compose.local.yml 中的端口映射
# ports:
#   - "其他端口:3000"
```

### 7.4 数据库连接失败

```bash
# 检查数据库容器状态
docker compose -f docker/docker-compose.local.yml ps

# 手动进入数据库容器
docker compose -f docker/docker-compose.local.yml exec db psql -U novelforge -d novelforge
```

### 7.5 数据丢失应急

**如误删 volume，立即停止操作并检查备份：**

```bash
# 查看所有 volume
docker volume ls

# 如 volume 还在（只是容器被删）
docker compose -f docker/docker-compose.local.yml up -d

# 如 volume 被误删，从备份恢复
docker run --rm -v novel-forge_pgdata:/target -v $(pwd)/backup:/backup alpine tar xzf /backup/pgdata_xxxx.tar.gz -C /target
```

---

## 8. 命令速查表

| 操作 | 命令 |
|------|------|
| 构建镜像 | `docker build -f docker/Dockerfile -t novelforge:latest .` |
| 导出镜像 | `docker save -o novelforge.tar novelforge:latest` |
| 导入镜像 | `docker load -i novelforge.tar` |
| 启动服务 | `docker compose -f docker/docker-compose.local.yml up -d` |
| 停止服务 | `docker compose -f docker/docker-compose.local.yml down` |
| 查看日志 | `docker compose -f docker/docker-compose.local.yml logs -f` |
| 查看状态 | `docker compose -f docker/docker-compose.local.yml ps` |
| 清理旧镜像 | `docker image prune -f` |
| 备份数据库 | `docker compose ... exec db pg_dump ... > backup/xxx.sql` |

---

## 9. 注意事项

1. **PowerShell 重定向**：导出镜像必须用 `docker save -o`，不能用 `>`，否则 tar 文件会损坏
2. **不要加 `-v`**：`docker compose down -v` 会删除数据库 volume，数据清零
3. **定期备份**：建议每周执行一次数据库导出，保存到服务器外部
4. **镜像大小**：tar 文件通常 500MB~2GB，上传需要一定时间
5. **宝塔终端**：长时间操作建议在宝塔终端执行，避免 SSH 断连导致操作中断
