"""システムルーター (ヘルスチェック等)"""
import asyncio
import json
import logging
import time

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_db
from app.llm.ollama import OllamaProvider
from app.models.schemas import HealthResponse

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()


@router.get("/health", response_model=HealthResponse)
async def health_check(db: AsyncSession = Depends(get_db)):
    # DB確認
    db_ok = False
    try:
        await db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        pass

    # Ollama確認
    llm = OllamaProvider()
    ollama_ok = await llm.health_check()

    return HealthResponse(
        status="ok" if (db_ok and ollama_ok) else "degraded",
        ollama=ollama_ok,
        database=db_ok,
    )


# 既知モデルのラベルマッピング（Ollama API の raw 名 → 表示ラベル）
_MODEL_LABELS: dict[str, str] = {
    "gpt-oss:20b": "GPT-OSS 20B (デフォルト)",
    "qwen3.5:35b-a3b": "Qwen3.5 35B-A3B (HauhauCS / セーフガード解除)",
}
# HauhauCS のフルネーム系も拾う
_LABEL_PATTERNS: list[tuple[str, str]] = [
    ("qwen3.5", "Qwen3.5 35B-A3B (HauhauCS / セーフガード解除)"),
    ("gpt-oss", "GPT-OSS 20B (デフォルト)"),
]


def _resolve_label(model_name: str) -> str:
    """モデル名から表示用ラベルを解決する"""
    if model_name in _MODEL_LABELS:
        return _MODEL_LABELS[model_name]
    name_lower = model_name.lower()
    for pattern, label in _LABEL_PATTERNS:
        if pattern in name_lower:
            return label
    return model_name


@router.get("/models")
async def list_models():
    """利用可能なモデル一覧を返す (Ollama /api/tags + llama.cpp)"""
    from app.llm.ollama import _is_llamacpp_model

    models: list[dict] = []
    ollama_base = settings.ollama_url.rstrip("/")
    llamacpp_base = settings.llama_cpp_url.rstrip("/")

    # Ollama モデル
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{ollama_base}/api/tags")
            if resp.status_code == 200:
                data = resp.json()
                for m in data.get("models", []):
                    name = m["name"]
                    if _is_llamacpp_model(name):
                        continue  # llama.cpp 用モデルは下で別途追加
                    models.append({"name": name, "label": _resolve_label(name)})
    except Exception:
        pass

    # llama.cpp モデル (Ollama に登録されている qwen 系を取得)
    llamacpp_online = False
    launcher_available = False
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"{llamacpp_base}/health")
            llamacpp_online = resp.status_code == 200
    except Exception:
        pass

    if not llamacpp_online:
        # ランチャーが動いていれば起動可能
        try:
            launcher_base = settings.llama_cpp_launcher_url.rstrip("/")
            async with httpx.AsyncClient(timeout=2) as client:
                resp = await client.get(f"{launcher_base}/status")
                launcher_available = resp.status_code == 200
        except Exception:
            pass

    # Ollama のタグ一覧から qwen 系を探す
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{ollama_base}/api/tags")
            if resp.status_code == 200:
                for m in resp.json().get("models", []):
                    name = m["name"]
                    if _is_llamacpp_model(name):
                        if llamacpp_online:
                            status_suffix = " [稼働中]"
                        elif launcher_available:
                            status_suffix = " [選択で自動起動]"
                        else:
                            status_suffix = " [要: ./dlnt.sh up]"
                        models.append({
                            "name": name,
                            "label": _resolve_label(name) + status_suffix,
                            "backend": "llamacpp",
                            "online": llamacpp_online,
                        })
    except Exception:
        pass

    if models:
        return {"models": models}

    # fallback: models.yaml の静的リスト
    try:
        import yaml
        with open("/app/config/models.yaml") as f:
            config = yaml.safe_load(f)
        fallback = config.get("available_models", [])
        if fallback:
            return {"models": fallback}
    except Exception:
        pass

    return {
        "models": [
            {"name": "gpt-oss:20b", "label": "GPT-OSS 20B (デフォルト)"},
        ]
    }


# ─── モデルウォームアップ (SSE) ──────────────────────────────────

class WarmupRequest(BaseModel):
    model: str


@router.post("/models/warmup")
async def warmup_model(body: WarmupRequest):
    """モデルをプリロードし、進捗を SSE で返す"""
    from app.llm.ollama import _is_llamacpp_model

    model_name = body.model
    is_llamacpp = _is_llamacpp_model(model_name)
    ollama_base = settings.ollama_url.rstrip("/")
    llamacpp_base = settings.llama_cpp_url.rstrip("/")

    async def _event_generator():
        def event(data: dict) -> str:
            return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

        # ── llama.cpp モデルの場合: ランチャー経由でオンデマンド起動 ──
        if is_llamacpp:
            launcher_base = settings.llama_cpp_launcher_url.rstrip("/")

            # 1. 既に起動済みか確認
            try:
                async with httpx.AsyncClient(timeout=3) as client:
                    resp = await client.get(f"{llamacpp_base}/health")
                    if resp.status_code == 200:
                        yield event({"status": "ready", "progress": 100, "model": model_name, "message": "llama.cpp サーバー接続OK"})
                        return
            except Exception:
                pass

            # 2. ランチャーに起動リクエスト
            yield event({"status": "loading", "progress": 5, "model": model_name, "message": "llama.cpp サーバーを起動中..."})
            try:
                async with httpx.AsyncClient(timeout=5) as client:
                    resp = await client.post(f"{launcher_base}/start")
                    if resp.status_code != 200:
                        yield event({"status": "error", "progress": 0, "model": model_name, "message": "ランチャーエラー"})
                        return
                    result = resp.json()
                    if result.get("status") == "error":
                        yield event({"status": "error", "progress": 0, "model": model_name, "message": result.get("message", "起動失敗")})
                        return
            except httpx.ConnectError:
                yield event({
                    "status": "error",
                    "progress": 0,
                    "model": model_name,
                    "message": "ランチャー未起動。./dlnt.sh up で起動してください。",
                })
                return
            except Exception as e:
                yield event({"status": "error", "progress": 0, "model": model_name, "message": f"ランチャー接続失敗: {e}"})
                return

            # 3. モデルロード完了をポーリング (20GB → 60〜120秒)
            start = time.monotonic()
            max_wait = 180
            yield event({"status": "loading", "progress": 10, "model": model_name, "message": "モデルをロード中..."})

            while True:
                await asyncio.sleep(2)
                elapsed = time.monotonic() - start

                if elapsed > max_wait:
                    yield event({"status": "error", "progress": 0, "model": model_name, "message": f"タイムアウト ({max_wait}秒)"})
                    return

                try:
                    async with httpx.AsyncClient(timeout=3) as client:
                        resp = await client.get(f"{llamacpp_base}/health")
                        if resp.status_code == 200:
                            yield event({
                                "status": "ready",
                                "progress": 100,
                                "model": model_name,
                                "message": f"ロード完了 ({elapsed:.0f}秒)",
                            })
                            return
                except Exception:
                    pass

                # 進捗推定 (120秒想定)
                progress = min(int(10 + (elapsed / 120) * 85), 95)
                yield event({
                    "status": "loading",
                    "progress": progress,
                    "model": model_name,
                    "message": f"モデルをロード中... ({elapsed:.0f}秒経過)",
                })
            return

        # ── Ollama モデルの場合 ──
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                # 1. 現在ロード中のモデルを確認
                ps_resp = await client.get(f"{ollama_base}/api/ps")
                loaded = []
                if ps_resp.status_code == 200:
                    loaded = [m["name"] for m in ps_resp.json().get("models", [])]

                if model_name in loaded:
                    yield event({"status": "ready", "progress": 100, "model": model_name, "message": "ロード済み"})
                    return

                # 2. モデルサイズを取得 (ロード時間推定用)
                size_bytes = 0
                try:
                    show_resp = await client.post(
                        f"{ollama_base}/api/show",
                        json={"model": model_name},
                    )
                    if show_resp.status_code == 200:
                        show_data = show_resp.json()
                        # modelinfo.size or parameter_size
                        size_bytes = show_data.get("size", 0)
                except Exception:
                    pass

                size_gb = max(size_bytes / (1024**3), 1.0)
                # Apple Silicon 統合メモリ: 概算 1〜3秒/GB
                est_seconds = max(size_gb * 2.0, 5.0)

                yield event({
                    "status": "loading",
                    "progress": 0,
                    "model": model_name,
                    "size_gb": round(size_gb, 1),
                    "message": f"モデルをロード中... ({size_gb:.1f} GB)",
                })

                # 3. 前モデルをアンロード
                if loaded:
                    yield event({"status": "unloading", "progress": 5, "model": model_name, "message": f"前モデルをアンロード中..."})
                    try:
                        await client.post(
                            f"{ollama_base}/api/generate",
                            json={"model": loaded[0], "keep_alive": 0},
                            timeout=15,
                        )
                    except Exception:
                        pass

            # 4. モデルをロード開始 (長時間かかるので専用 client)
            load_task_done = asyncio.Event()
            load_error: list[str] = []

            async def _load():
                try:
                    async with httpx.AsyncClient(timeout=300) as lc:
                        resp = await lc.post(
                            f"{ollama_base}/api/generate",
                            json={"model": model_name, "prompt": "", "keep_alive": "5m"},
                        )
                        # Ollama がエラーを返した場合
                        if resp.status_code != 200:
                            try:
                                body = resp.json()
                                load_error.append(body.get("error", f"HTTP {resp.status_code}"))
                            except Exception:
                                load_error.append(f"HTTP {resp.status_code}")
                        else:
                            body = resp.json()
                            if "error" in body:
                                load_error.append(body["error"])
                except Exception as e:
                    load_error.append(str(e))
                    logger.warning("モデルロードリクエスト失敗: %s", e)
                finally:
                    load_task_done.set()

            asyncio.create_task(_load())

            # 5. ポーリングで進捗を推定
            start = time.monotonic()
            last_progress = 10
            yield event({"status": "loading", "progress": 10, "model": model_name, "message": "モデルをロード中..."})

            while not load_task_done.is_set():
                await asyncio.sleep(0.5)
                elapsed = time.monotonic() - start
                # シグモイド風の進捗推定 (最初速く、後半ゆっくり)
                ratio = min(elapsed / est_seconds, 1.0)
                progress = int(10 + ratio * 85)  # 10〜95%
                progress = min(progress, 95)

                if progress > last_progress:
                    last_progress = progress
                    elapsed_str = f"{elapsed:.0f}秒経過"
                    yield event({
                        "status": "loading",
                        "progress": progress,
                        "model": model_name,
                        "message": f"モデルをロード中... ({elapsed_str})",
                    })

            # ロードエラーの場合は即座に通知
            if load_error:
                err_msg = load_error[0]
                if "unable to load" in err_msg:
                    err_msg = "モデルのロードに失敗しました。Ollama がこのモデル形式に対応していない可能性があります。"
                yield event({
                    "status": "error",
                    "progress": 0,
                    "model": model_name,
                    "message": err_msg,
                })
                return

            # 6. ロード完了確認
            try:
                async with httpx.AsyncClient(timeout=5) as client:
                    ps_resp = await client.get(f"{ollama_base}/api/ps")
                    if ps_resp.status_code == 200:
                        loaded_now = [m["name"] for m in ps_resp.json().get("models", [])]
                        if model_name in loaded_now:
                            total_time = time.monotonic() - start
                            yield event({
                                "status": "ready",
                                "progress": 100,
                                "model": model_name,
                                "message": f"ロード完了 ({total_time:.1f}秒)",
                            })
                            return
            except Exception:
                pass

            # ロードタスク完了したがpsに出ない場合も完了扱い
            total_time = time.monotonic() - start
            yield event({
                "status": "ready",
                "progress": 100,
                "model": model_name,
                "message": f"ロード完了 ({total_time:.1f}秒)",
            })

        except Exception as e:
            logger.error("ウォームアップ失敗: %s", e)
            yield event({"status": "error", "progress": 0, "model": model_name, "message": f"エラー: {e}"})

    return StreamingResponse(_event_generator(), media_type="text/event-stream")
