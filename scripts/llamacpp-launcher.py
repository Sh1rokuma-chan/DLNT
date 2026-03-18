#!/usr/bin/env python3
"""llama.cpp サーバーのオンデマンド起動/停止を管理する軽量コントロール API

ポート 11436 で待機し、DLNT API (Docker内) からの HTTP リクエストで
llama-server プロセスを起動/停止する。モデルはロードしない (プロセス管理のみ)。

使い方:
  POST /start  → llama-server を起動 (既に起動中なら何もしない)
  POST /stop   → llama-server を停止
  GET  /status  → {"running": bool, "pid": int|null}
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Optional

LLAMA_DIR = os.path.expanduser("~/llama-cpp/llama-b8398")
LLAMA_SERVER = os.path.join(LLAMA_DIR, "llama-server")
MODEL_PATH = os.path.expanduser(
    "~/.ollama/models/blobs/"
    "sha256-c117a47c5d8d1bb91d68031aaa77891f10118338e1174accc48c55ee3fff8717"
)
PORT = 11436
LLAMA_PORT = 11435

_proc: Optional[subprocess.Popen] = None


def _is_running() -> bool:
    global _proc
    if _proc is None:
        return False
    if _proc.poll() is not None:
        _proc = None
        return False
    return True


def _start_server() -> dict:
    global _proc
    if _is_running():
        return {"status": "already_running", "pid": _proc.pid}

    if not os.path.exists(LLAMA_SERVER):
        return {"status": "error", "message": f"llama-server not found: {LLAMA_SERVER}"}
    if not os.path.exists(MODEL_PATH):
        return {"status": "error", "message": f"Model not found: {MODEL_PATH}"}

    env = os.environ.copy()
    env["DYLD_LIBRARY_PATH"] = LLAMA_DIR

    _proc = subprocess.Popen(
        [
            LLAMA_SERVER,
            "-m", MODEL_PATH,
            "-ngl", "0",
            "-c", "4096",
            "-t", "8",
            "--host", "0.0.0.0",
            "--port", str(LLAMA_PORT),
        ],
        env=env,
        stdout=open("/tmp/llamacpp-server.log", "a"),
        stderr=subprocess.STDOUT,
    )
    return {"status": "starting", "pid": _proc.pid}


def _stop_server() -> dict:
    global _proc
    if not _is_running():
        return {"status": "not_running"}
    _proc.terminate()
    try:
        _proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        _proc.kill()
    pid = _proc.pid
    _proc = None
    return {"status": "stopped", "pid": pid}


class Handler(BaseHTTPRequestHandler):
    def _respond(self, data: dict, code: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path == "/start":
            self._respond(_start_server())
        elif self.path == "/stop":
            self._respond(_stop_server())
        else:
            self._respond({"error": "not found"}, 404)

    def do_GET(self):
        if self.path == "/status":
            running = _is_running()
            self._respond({
                "running": running,
                "pid": _proc.pid if running else None,
            })
        else:
            self._respond({"error": "not found"}, 404)

    def log_message(self, format, *args):
        pass  # 静かに


def _shutdown(signum, frame):
    _stop_server()
    sys.exit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    print(f"llama.cpp launcher listening on :{PORT}")
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        _stop_server()
