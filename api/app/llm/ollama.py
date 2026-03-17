"""Ollama LLMプロバイダー実装"""
import json
import logging
from typing import AsyncIterator

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class OllamaProvider:
    """Ollama /api/chat エンドポイントとのストリーミング通信"""

    def __init__(self, base_url: str | None = None, model: str | None = None):
        self.base_url = (base_url or settings.ollama_url).rstrip("/")
        self.model = model or settings.ollama_model
        self.timeout = settings.ollama_timeout

    async def chat(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        stream: bool = True,
    ) -> AsyncIterator[str]:
        """Ollamaとストリーミングチャット。トークンを順次yield。"""
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

                    # tool_calls がある場合はJSONとして返す
                    if data.get("message", {}).get("tool_calls"):
                        yield json.dumps({"tool_calls": data["message"]["tool_calls"]})
                        return

                    # 通常トークン
                    content = data.get("message", {}).get("content", "")
                    if content:
                        yield content

                    if data.get("done"):
                        return

    async def chat_complete(self, messages: list[dict], tools: list[dict] | None = None) -> str:
        """ストリーミングなし完全レスポンスを返す（ルーティング判定等に使用）"""
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
        """テキストのエンベディングベクトルを取得"""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self.base_url}/api/embeddings",
                json={"model": self.model, "prompt": text},
            )
            resp.raise_for_status()
            return resp.json()["embedding"]

    async def health_check(self) -> bool:
        """Ollamaが起動しているか確認"""
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{self.base_url}/api/tags")
                return resp.status_code == 200
        except Exception:
            return False
