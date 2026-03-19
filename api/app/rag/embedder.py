"""テキストエンベディング (Ollama API 経由)"""
import asyncio
import gc
import json
import logging
import urllib.request
from typing import List

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_OLLAMA_EMBED_URL = f"{settings.ollama_url.rstrip('/')}/api/embeddings"


def _embed_sync(text: str) -> List[float] | None:
    """Ollama /api/embeddings を同期で呼ぶ"""
    try:
        data = json.dumps({"model": settings.embedding_model, "prompt": text}).encode()
        req = urllib.request.Request(
            _OLLAMA_EMBED_URL,
            data=data,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read()
            result = json.loads(body)
            return result["embedding"]
    except Exception as e:
        logger.warning("embed失敗: %s", e)
        return None


async def embed_text(text: str) -> List[float] | None:
    """テキストをベクトルに変換（非同期ラッパー）"""
    return await asyncio.to_thread(_embed_sync, text)


async def embed_batch(texts: List[str]) -> List[List[float] | None]:
    """複数テキストを1件ずつ embed。to_thread でイベントループを塞がない。"""
    results = []
    for i, text in enumerate(texts):
        vec = await embed_text(text)
        results.append(vec)
        if (i + 1) % 5 == 0:
            gc.collect()
    return results
