from __future__ import annotations

import json
import os
from typing import AsyncGenerator, Literal

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/chat", tags=["chat"])

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_CHAT_URL = f"{OLLAMA_BASE_URL.rstrip('/')}/api/chat"
UPSTREAM_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "60"))


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str = Field(min_length=1)


class ChatStreamRequest(BaseModel):
    model: str = Field(min_length=1)
    messages: list[ChatMessage] = Field(min_length=1)


async def _relay_ollama_stream(payload: ChatStreamRequest) -> AsyncGenerator[str, None]:
    request_payload = payload.model_dump()
    request_payload["stream"] = True

    timeout = httpx.Timeout(UPSTREAM_TIMEOUT_SECONDS)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", OLLAMA_CHAT_URL, json=request_payload) as response:
                if response.status_code >= 400:
                    body = (await response.aread()).decode("utf-8", errors="ignore")
                    detail = body.strip() or "Ollama upstream error"
                    raise HTTPException(status_code=response.status_code, detail=detail)

                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        # 未知形式のチャンクもそのまま返す
                        yield f"data: {line}\n\n"
                        continue

                    token = chunk.get("message", {}).get("content")
                    if token:
                        yield f"data: {token}\n\n"

                    if chunk.get("done"):
                        yield "event: done\ndata: [DONE]\n\n"
                        break

    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Ollama upstream timeout") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Failed to connect to Ollama upstream") from exc


@router.post("/stream")
async def stream_chat(payload: ChatStreamRequest) -> StreamingResponse:
    return StreamingResponse(
        _relay_ollama_stream(payload),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
