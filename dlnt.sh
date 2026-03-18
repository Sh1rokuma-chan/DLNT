#!/bin/bash
# ============================================================
# DLNT — 統合起動/停止スクリプト
# ============================================================
# 使い方:
#   ./dlnt.sh up     → Docker Compose + ランチャー起動
#   ./dlnt.sh down   → 全サービス停止 (Docker + llama.cpp + Ollama)
#   ./dlnt.sh status → 各サービスの稼働状態
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCHER_PID="/tmp/llamacpp-launcher.pid"
LAUNCHER_SCRIPT="$SCRIPT_DIR/scripts/llamacpp-launcher.py"

case "$1" in
  up)
    echo "=== DLNT 起動 ==="

    # 1. Docker Compose
    echo "→ Docker Compose 起動中..."
    cd "$SCRIPT_DIR" && docker compose up -d

    # 2. llama.cpp ランチャー (プロセス管理API、モデルはロードしない)
    if [ -f "$LAUNCHER_PID" ] && kill -0 "$(cat "$LAUNCHER_PID")" 2>/dev/null; then
      echo "→ llama.cpp ランチャー: 既に起動中 (PID $(cat "$LAUNCHER_PID"))"
    else
      echo "→ llama.cpp ランチャー起動中..."
      python3 "$LAUNCHER_SCRIPT" &
      echo $! > "$LAUNCHER_PID"
      echo "  ランチャー起動 (PID $!, ポート 11436)"
      echo "  ※ llama.cpp サーバーは qwen モデル選択時にオンデマンド起動"
    fi

    echo ""
    echo "=== DLNT 起動完了 ==="
    echo "  http://localhost:8080/    → Tak AI Chat"
    echo "  http://localhost:19999/   → Netdata"
    ;;

  down)
    echo "=== DLNT 停止 ==="

    # 1. llama.cpp サーバー停止 (ランチャー経由)
    if [ -f "$LAUNCHER_PID" ] && kill -0 "$(cat "$LAUNCHER_PID")" 2>/dev/null; then
      echo "→ llama.cpp サーバー停止中..."
      curl -s -X POST http://localhost:11436/stop > /dev/null 2>&1
      echo "→ llama.cpp ランチャー停止中..."
      kill "$(cat "$LAUNCHER_PID")" 2>/dev/null
      rm -f "$LAUNCHER_PID"
    else
      # ランチャーなしで直接 llama-server が動いている場合
      pkill -f "llama-server.*port 11435" 2>/dev/null
    fi

    # 2. Docker Compose
    echo "→ Docker Compose 停止中..."
    cd "$SCRIPT_DIR" && docker compose down

    # 3. Ollama
    echo "→ Ollama 停止中..."
    pkill -x ollama 2>/dev/null || true

    echo ""
    echo "=== DLNT 全停止完了 ==="
    ;;

  status)
    echo "=== DLNT サービス状態 ==="

    # Docker
    echo ""
    echo "--- Docker Compose ---"
    cd "$SCRIPT_DIR" && docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null

    # Ollama
    echo ""
    echo -n "--- Ollama: "
    if curl -s -o /dev/null -w "" http://localhost:11434/api/tags 2>/dev/null; then
      echo "稼働中 ---"
      curl -s http://localhost:11434/api/ps 2>/dev/null | python3 -m json.tool 2>/dev/null || true
    else
      echo "停止 ---"
    fi

    # llama.cpp ランチャー
    echo ""
    echo -n "--- llama.cpp ランチャー: "
    if [ -f "$LAUNCHER_PID" ] && kill -0 "$(cat "$LAUNCHER_PID")" 2>/dev/null; then
      echo "稼働中 (PID $(cat "$LAUNCHER_PID")) ---"
      curl -s http://localhost:11436/status 2>/dev/null | python3 -m json.tool 2>/dev/null || true
    else
      echo "停止 ---"
    fi

    # llama.cpp サーバー
    echo ""
    echo -n "--- llama.cpp サーバー: "
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:11435/health 2>/dev/null | grep -q "200"; then
      echo "稼働中 ---"
    else
      echo "停止 ---"
    fi
    ;;

  *)
    echo "使い方: $0 {up|down|status}"
    exit 1
    ;;
esac
