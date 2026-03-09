#!/bin/bash
# ============================================================
# 全サービス一括停止スクリプト
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${RED}  全サービスを停止します${NC}"
echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 1. フロントエンド停止
echo "[1/4] フロントエンドを停止中..."
pkill -f "node.*server.js" 2>/dev/null && echo "  → 停止しました" || echo "  → 起動していませんでした"

# 2. MCP Server停止
echo "[2/4] MCP Serverを停止中..."
pkill -f "node.*runner.js" 2>/dev/null && echo "  → 停止しました" || echo "  → 起動していませんでした"

# 3. Ollama停止
echo "[3/4] Ollamaを停止中..."
pkill ollama 2>/dev/null && echo "  → 停止しました" || echo "  → 起動していませんでした"

# 4. Dify停止
echo "[4/4] Difyを停止中..."
if [ -d "$PROJECT_DIR/dify/docker" ]; then
    cd "$PROJECT_DIR/dify/docker"
    docker compose down 2>/dev/null && echo "  → 停止しました" || echo "  → 起動していませんでした"
fi

echo ""
echo -e "${GREEN}全サービスを完全に停止しました。${NC}"
echo "--------------------------------------------------------"
echo "再起動する場合は、以下のコマンドを実行してください："
echo "  ./scripts/start-all.sh"
echo "--------------------------------------------------------"
echo ""
