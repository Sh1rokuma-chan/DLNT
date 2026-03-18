"""ToolRegistry — ツールのプラグイン管理"""
from app.tools.base import BaseTool


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, BaseTool] = {}

    def register(self, tool: BaseTool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> BaseTool | None:
        return self._tools.get(name)

    def all(self) -> list[BaseTool]:
        return list(self._tools.values())

    def to_ollama_tools(self) -> list[dict]:
        return [t.to_ollama_tool() for t in self._tools.values()]

    def names(self) -> list[str]:
        return list(self._tools.keys())


# シングルトン
_registry: ToolRegistry | None = None


def get_registry() -> ToolRegistry:
    global _registry
    if _registry is None:
        _registry = _build_registry()
    return _registry


def _build_registry() -> ToolRegistry:
    from app.tools.web_search import WebSearchTool
    from app.tools.web_fetch import WebFetchTool
    from app.tools.file_ops import FileReadTool, FileWriteTool, FileSearchTool
    from app.tools.shell_exec import ShellExecTool
    from app.tools.code_exec import CodeExecTool
    from app.tools.whisper import WhisperTool
    from app.tools.memory_search import MemorySearchTool

    registry = ToolRegistry()
    for tool in [
        WebSearchTool(),
        WebFetchTool(),
        FileReadTool(),
        FileWriteTool(),
        FileSearchTool(),
        ShellExecTool(),
        CodeExecTool(),
        WhisperTool(),
        MemorySearchTool(),
    ]:
        registry.register(tool)
    return registry
