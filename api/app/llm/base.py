"""LLMプロバイダー抽象インターフェース"""
from typing import AsyncIterator, Protocol, runtime_checkable


@runtime_checkable
class LLMProvider(Protocol):
    async def chat(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        stream: bool = True,
    ) -> AsyncIterator[str]:
        ...

    async def embed(self, text: str) -> list[float]:
        ...
