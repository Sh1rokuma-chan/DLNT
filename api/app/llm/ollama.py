"""LLMプロバイダー実装 (Ollama + llama.cpp サーバー)"""
import asyncio
import json
import logging
from typing import AsyncIterator

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# グローバル排他ロック: 24GB環境で2モデル同時ロードによるOOMを防止
_llm_lock = asyncio.Lock()
_active_model: str | None = None

# llama.cpp サーバーで動かすモデルのパターン
_LLAMACPP_PATTERNS = ["qwen3.5", "hauhaus", "uncensored"]


def _is_llamacpp_model(model_name: str) -> bool:
    """モデル名が llama.cpp サーバーで動かすべきものか判定"""
    lower = model_name.lower()
    return any(p in lower for p in _LLAMACPP_PATTERNS)


class OllamaProvider:
    """Ollama /api/chat + llama.cpp /v1/chat/completions の統合プロバイダー"""

    def __init__(self, base_url: str | None = None, model: str | None = None):
        self.model = model or settings.ollama_model
        self.timeout = settings.ollama_timeout
        self.use_llamacpp = _is_llamacpp_model(self.model)

        if self.use_llamacpp:
            self.base_url = settings.llama_cpp_url.rstrip("/")
        else:
            self.base_url = (base_url or settings.ollama_url).rstrip("/")

    async def _ensure_model_exclusive(self) -> None:
        """別モデルがアクティブなら先にアンロードする (24GB OOM防止)"""
        global _active_model
        if _active_model and _active_model != self.model:
            logger.info("モデル切替: %s → %s (前モデルをアンロード)", _active_model, self.model)
            # Ollama のモデルをアンロード (llama.cpp は手動管理なのでスキップ)
            if not _is_llamacpp_model(_active_model):
                try:
                    ollama_url = settings.ollama_url.rstrip("/")
                    async with httpx.AsyncClient(timeout=10) as client:
                        await client.post(
                            f"{ollama_url}/api/generate",
                            json={"model": _active_model, "keep_alive": 0},
                        )
                except Exception as e:
                    logger.warning("前モデルのアンロードに失敗: %s", e)
        _active_model = self.model

    # ─── llama.cpp (OpenAI 互換) ─────────────────────────────

    async def _chat_llamacpp(
        self, messages: list[dict], stream: bool = True
    ) -> AsyncIterator[str]:
        """llama.cpp /v1/chat/completions でストリーミング

        Qwen3.5 等の thinking model は reasoning_content と content を
        別フィールドで返す。既存の ReAct エンジンが <think> タグをパースする
        ため、reasoning_content を <think>...</think> に変換して yield する。
        """
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": stream,
            "max_tokens": 8192,
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            if not stream:
                resp = await client.post(
                    f"{self.base_url}/v1/chat/completions",
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
                msg = data["choices"][0]["message"]
                reasoning = msg.get("reasoning_content", "")
                content = msg.get("content", "") or ""
                # thinking model: reasoning_content を <think> タグで包む
                if reasoning:
                    yield f"<think>{reasoning}</think>\n{content}"
                else:
                    yield content
                return

            async with client.stream(
                "POST",
                f"{self.base_url}/v1/chat/completions",
                json=payload,
            ) as response:
                response.raise_for_status()
                in_reasoning = False
                async for line in response.aiter_lines():
                    line = line.strip()
                    if not line:
                        continue
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        if in_reasoning:
                            yield "</think>\n"
                        return
                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue
                    delta = data.get("choices", [{}])[0].get("delta", {})

                    # thinking model: reasoning_content → <think> タグ
                    reasoning = delta.get("reasoning_content", "")
                    if reasoning:
                        if not in_reasoning:
                            in_reasoning = True
                            yield "<think>"
                        yield reasoning
                        continue

                    content = delta.get("content", "")
                    if content:
                        if in_reasoning:
                            in_reasoning = False
                            yield "</think>\n"
                        yield content

    async def _chat_complete_llamacpp(self, messages: list[dict]) -> str:
        """llama.cpp 非ストリーミング"""
        result = ""
        async for token in self._chat_llamacpp(messages, stream=False):
            result += token
        return result

    # ─── Ollama ──────────────────────────────────────────────

    async def _chat_ollama(
        self, messages: list[dict], tools: list[dict] | None = None, stream: bool = True
    ) -> AsyncIterator[str]:
        """Ollama /api/chat でストリーミング"""
        payload: dict = {
            "model": self.model,
            "messages": messages,
            "stream": stream,
        }
        if tools:
            payload["tools"] = tools

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/chat",
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    if data.get("message", {}).get("tool_calls"):
                        yield json.dumps({"tool_calls": data["message"]["tool_calls"]})
                        return

                    content = data.get("message", {}).get("content", "")
                    if content:
                        yield content

                    if data.get("done"):
                        return

    # ─── 統合インターフェース ─────────────────────────────────

    async def chat(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        stream: bool = True,
    ) -> AsyncIterator[str]:
        """ストリーミングチャット。バックエンドを自動選択。"""
        async with _llm_lock:
            await self._ensure_model_exclusive()

            if self.use_llamacpp:
                async for token in self._chat_llamacpp(messages, stream=stream):
                    yield token
            else:
                async for token in self._chat_ollama(messages, tools, stream):
                    yield token

    async def chat_complete(self, messages: list[dict], tools: list[dict] | None = None) -> str:
        """非ストリーミング完全レスポンス"""
        async with _llm_lock:
            await self._ensure_model_exclusive()

            if self.use_llamacpp:
                return await self._chat_complete_llamacpp(messages)
            else:
                payload: dict = {
                    "model": self.model,
                    "messages": messages,
                    "stream": False,
                }
                if tools:
                    payload["tools"] = tools

                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    resp = await client.post(f"{self.base_url}/api/chat", json=payload)
                    resp.raise_for_status()
                    data = resp.json()
                    return data.get("message", {}).get("content", "")

    async def embed(self, text: str) -> list[float]:
        """テキストのエンベディングベクトルを取得 (常に Ollama)"""
        ollama_url = settings.ollama_url.rstrip("/")
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{ollama_url}/api/embeddings",
                json={"model": settings.embedding_model, "prompt": text},
            )
            resp.raise_for_status()
            return resp.json()["embedding"]

    async def health_check(self) -> bool:
        """バックエンドが起動しているか確認"""
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                if self.use_llamacpp:
                    resp = await client.get(f"{self.base_url}/health")
                    return resp.status_code == 200
                else:
                    resp = await client.get(f"{self.base_url}/api/tags")
                    return resp.status_code == 200
        except Exception:
            return False
