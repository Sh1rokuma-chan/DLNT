#!/bin/bash
# ============================================================
# Dify + Ollama + MCP ローカルAIエージェント セットアップスクリプト
# 対象: MacBook Pro M5 (24GB RAM, macOS Tahoe 26.3)
# ============================================================

set -e

# 色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║  Dify + Ollama + MCP ローカルAIエージェント セットアップ  ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_step() {
    echo -e "${GREEN}[STEP $1/$TOTAL_STEPS]${NC} $2"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

TOTAL_STEPS=6
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIFY_DIR="$PROJECT_DIR/dify"
MCP_DIR="$PROJECT_DIR/mcp-servers"
MODEL_NAME="hf.co/mmnga-o/NVIDIA-Nemotron-Nano-9B-v2-Japanese-gguf:Q5_K_M"

print_header

# ============================================================
# STEP 1: 前提条件チェック
# ============================================================
print_step 1 "前提条件を確認中..."

# Homebrew
if ! command -v brew &> /dev/null; then
    print_warn "Homebrewが見つかりません。インストールします..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
    print_success "Homebrew: $(brew --version | head -1)"
fi

# Docker
if ! command -v docker &> /dev/null; then
    print_error "Docker Desktopがインストールされていません"
    echo "  → https://www.docker.com/products/docker-desktop/ からインストールしてください"
    echo "  → インストール後、Docker Desktopを起動してから再実行してください"
    exit 1
else
    print_success "Docker: $(docker --version)"
fi

# Docker Compose
if ! docker compose version &> /dev/null; then
    print_error "Docker Composeが利用できません"
    echo "  → Docker Desktopを最新版に更新してください"
    exit 1
else
    print_success "Docker Compose: $(docker compose version)"
fi

# Node.js
if ! command -v node &> /dev/null; then
    print_warn "Node.jsが見つかりません。Homebrewでインストールします..."
    brew install node
else
    print_success "Node.js: $(node --version)"
fi

# Git
if ! command -v git &> /dev/null; then
    print_warn "Gitが見つかりません。Homebrewでインストールします..."
    brew install git
else
    print_success "Git: $(git --version)"
fi

echo ""

# ============================================================
# STEP 2: Ollamaのインストールとモデルダウンロード
# ============================================================
print_step 2 "Ollamaをセットアップ中..."

if ! command -v ollama &> /dev/null; then
    print_warn "Ollamaが見つかりません。インストールします..."
    brew install ollama
    print_success "Ollamaをインストールしました"
else
    print_success "Ollama: $(ollama --version 2>/dev/null || echo 'installed')"
fi

# Ollamaサービスが起動しているか確認
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    print_warn "Ollamaサービスを起動します..."
    ollama serve &
    sleep 5
fi

# モデルのダウンロード
echo ""
echo -e "${YELLOW}Nemotron-Nano-9B-v2-Japanese (Q5_K_M, ~7GB) をダウンロードします${NC}"
echo "  これには数分〜数十分かかる場合があります..."
echo ""

if ollama list 2>/dev/null | grep -q "nemotron"; then
    print_success "Nemotronモデルは既にダウンロード済みです"
else
    ollama pull "$MODEL_NAME"
    print_success "モデルのダウンロードが完了しました"
fi

echo ""

# ============================================================
# STEP 3: Difyのセットアップ
# ============================================================
print_step 3 "Difyをセットアップ中..."

if [ -d "$DIFY_DIR" ]; then
    print_warn "Difyディレクトリが既に存在します。更新をスキップします"
else
    echo "Difyリポジトリをクローン中..."
    git clone https://github.com/langgenius/dify.git "$DIFY_DIR"
    print_success "Difyリポジトリをクローンしました"
fi

# Dify環境設定
cd "$DIFY_DIR/docker"

if [ ! -f .env ]; then
    cp .env.example .env 2>/dev/null || true
    print_success "Dify環境設定ファイルを作成しました"
fi

# Docker Composeで起動
echo "Difyコンテナを起動中（初回は数分かかります）..."
docker compose up -d
print_success "Difyが起動しました → http://localhost/install"

echo ""

# ============================================================
# STEP 4: MCP Filesystem Server のセットアップ
# ============================================================
print_step 4 "MCP Filesystem Serverをセットアップ中..."

mkdir -p "$MCP_DIR"
cd "$MCP_DIR"

# supergateway (stdio→SSE変換) のインストール
echo "supergatewayをインストール中..."
npm install -g supergateway @anthropic-ai/mcp-filesystem-server 2>/dev/null || {
    npm install -g supergateway @modelcontextprotocol/server-filesystem 2>/dev/null
}
print_success "MCP Filesystem Serverをインストールしました"

# MCP起動スクリプトの作成
cat > "$MCP_DIR/start-mcp.sh" << 'MCPEOF'
#!/bin/bash
# MCP Filesystem Server を HTTP/SSE で起動
# supergateway経由でstdio→SSE変換

WORKSPACE_DIR="${1:-$HOME/Documents}"

echo "MCP Filesystem Server を起動します"
echo "  ワークスペース: $WORKSPACE_DIR"
echo "  エンドポイント: http://localhost:8808/sse"
echo ""

npx -y supergateway \
  --stdio "npx -y @modelcontextprotocol/server-filesystem $WORKSPACE_DIR" \
  --port 8808
MCPEOF

chmod +x "$MCP_DIR/start-mcp.sh"
print_success "MCP起動スクリプトを作成しました"

echo ""

# ============================================================
# STEP 5: フロントエンドのセットアップ
# ============================================================
print_step 5 "カスタムWebフロントエンドをセットアップ中..."

cd "$PROJECT_DIR/frontend"

# .env ファイルの作成
if [ ! -f "$PROJECT_DIR/.env" ] && [ -f "$PROJECT_DIR/.env.example" ]; then
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    print_success ".env ファイルを作成しました"
fi

# 依存パッケージのインストール
if [ ! -d node_modules ]; then
    npm install > /dev/null 2>&1
    print_success "フロントエンド依存パッケージをインストールしました"
else
    print_success "フロントエンド依存パッケージは既にインストール済みです"
fi

echo ""

# ============================================================
# STEP 6: 完了メッセージ
# ============================================================
print_step 6 "セットアップ完了！"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              セットアップが完了しました！              ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo "■ 次のステップ:"
echo ""
echo "  1. Dify初期設定:"
echo "     → ブラウザで http://localhost/install を開く"
echo "     → 管理者アカウントを作成"
echo ""
echo "  2. OllamaをDifyに接続:"
echo "     → Dify設定 → モデルプロバイダー → Ollama"
echo "     → Model Name: $MODEL_NAME"
echo "     → Base URL: http://host.docker.internal:11434"
echo ""
echo "  3. MCP Filesystem Serverを起動:"
echo "     → cd $MCP_DIR && ./start-mcp.sh ~/Documents"
echo ""
echo "  4. MCPをDifyに接続:"
echo "     → Dify → ツール → MCP → Add MCP Server (HTTP)"
echo "     → Server URL: http://host.docker.internal:8808/sse"
echo ""
echo "  5. DSLファイルをインポート:"
echo "     → Dify → スタジオ → DSLファイルをインポート"
echo "     → $PROJECT_DIR/dsl/agent_workflow.yml を選択"
echo ""
echo "  6. カスタムフロントエンドを起動:"
echo "     → cd $PROJECT_DIR/frontend && node server.js"
echo "     → ブラウザで http://localhost:3001 を開く"
echo ""
echo "■ サービス一覧:"
echo "  Dify:       http://localhost"
echo "  Ollama:     http://localhost:11434"
echo "  MCP Server: http://localhost:8808/sse"
echo "  Frontend:   http://localhost:3001"
echo ""
