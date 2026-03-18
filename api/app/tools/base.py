"""ツール基底クラス"""
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolResult:
    success: bool
    data: Any
    display: str
    error: str = ""


class BaseTool:
    name: str = ""
    description: str = ""
    parameters: dict = field(default_factory=dict)
    timeout: int = 30

    async def execute(self, args: dict, context: dict | None = None) -> ToolResult:
        raise NotImplementedError

    def to_ollama_tool(self) -> dict:
        """Ollama tools APIフォーマットへ変換"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }
