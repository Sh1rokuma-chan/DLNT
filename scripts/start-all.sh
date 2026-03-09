#!/bin/bash
# ============================================================
# 全サービス一括起動スクリプト
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE_DIR="${1:-$HOME/Documents}"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  全サービスを起動します${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

mkdir -p "$PROJECT_DIR/logs"

# 1. Ollama
echo -e "${GREEN}[1/4]${NC} Ollama を確認中..."
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "  → Ollama は既に起動中です"
else
    echo "  → Ollama を起動します..."
    ollama serve &
    sleep 3
    echo "  → Ollama 起動完了"
fi

# 2. Dify
echo -e "${GREEN}[2/4]${NC} Dify を起動中..."
cd "$PROJECT_DIR/dify/docker"
if docker compose ps 2>/dev/null | grep -q "running"; then
    echo "  → Dify は既に起動中です"
else
    docker compose up -d
    echo "  → Dify 起動完了（初期化に1-2分かかる場合があります）"
fi

# 3. MCP Filesystem Server
echo -e "${GREEN}[3/4]${NC} MCP Filesystem Server を起動中..."
echo "  → ワークスペース: $WORKSPACE_DIR"

# 既存プロセスを停止
pkill -f "supergateway.*8808" 2>/dev/null || true
sleep 1

if [ -d "$PROJECT_DIR/mcp-servers" ]; then
    cd "$PROJECT_DIR/mcp-servers"
    nohup ./start-mcp.sh "$WORKSPACE_DIR" > "$PROJECT_DIR/logs/mcp.log" 2>&1 &
    echo "  → MCP Server 起動完了 (PID: $!)"
else
    echo "  → MCP Serverのディレクトリが見つかりません。スキップします。"
fi

# 4. カスタムフロントエンド
echo -e "${GREEN}[4/4]${NC} カスタムフロントエンドを起動中..."

# 既存プロセスを停止
pkill -f "node.*server.js.*3001" 2>/dev/null || true
sleep 1

mkdir -p "$PROJECT_DIR/logs"
cd "$PROJECT_DIR/frontend"
nohup node server.js > "$PROJECT_DIR/logs/frontend.log" 2>&1 &
echo "  → フロントエンド起動完了 (PID: $!)"

echo ""

# ヘルスチェック待機
echo -e "${YELLOW}ヘルスチェック中...${NC}"
for i in $(seq 1 10); do
    sleep 2
    ALL_OK=true
    curl -s http://localhost:3001/api/health > /dev/null 2>&1 || ALL_OK=false
    if [ "$ALL_OK" = true ]; then
        break
    fi
    echo "  → 待機中... ($i/10)"
done

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  全サービスが起動しました！${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Dify:       http://localhost"
echo "  Ollama:     http://localhost:11434"
echo "  MCP Server: http://localhost:8808/sse"
echo "  Frontend:   http://localhost:3001"
echo ""
echo "  ログ: $PROJECT_DIR/logs/"
echo ""
