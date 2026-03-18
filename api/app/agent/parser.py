"""ツール呼び出しパーサー (native tool_calls + XMLタグフォールバック)"""
import json
import logging
import re
from dataclasses import dataclass
from typing import Union

logger = logging.getLogger(__name__)


@dataclass
class ToolCall:
    name: str
    args: dict


@dataclass
class FinalAnswer:
    content: str
    think_content: str = ""


ParseResult = Union[ToolCall, FinalAnswer]


class ToolCallParser:
    """
    Ollama native tool_calls → XMLタグ の2段階パーサー。
    - native: Ollama /api/chat の tool_calls フィールドを解析
    - xml: <tool_call>...</tool_call> タグを解析
    """

    def _unwrap_tool_call(self, name: str, args: dict) -> ToolCall:
        """ネストされたツール呼び出しをアンラップする。
        一部モデルが {"name": "assistant", "arguments": {"name": "web_fetch", "arguments": {...}}}
        のようにツール呼び出しを二重にラップするケースに対応。
        """
        if name in ("assistant", "tool", "function") and isinstance(args, dict) and "name" in args:
            inner_name = args["name"]
            inner_args = args.get("arguments", args.get("args", {}))
            logger.info("ネストされたツール呼び出しをアンラップ: %s → %s", name, inner_name)
            return ToolCall(name=inner_name, args=inner_args)
        return ToolCall(name=name, args=args)

    def parse_streaming_buffer(self, buffer: str) -> ParseResult:
        """ストリーミング完了後のバッファをパース"""
        # native tool_calls (OllamaがJSONとして返した場合)
        if buffer.strip().startswith('{"tool_calls":'):
            try:
                data = json.loads(buffer.strip())
                tc = data["tool_calls"][0]
                fn = tc.get("function", tc)
                name = fn.get("name", "")
                args = fn.get("arguments", fn.get("args", {}))
                return self._unwrap_tool_call(name, args)
            except Exception:
                pass

        # XMLタグ方式
        match = re.search(r"<tool_call>(.*?)</tool_call>", buffer, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(1).strip())
                return ToolCall(name=data.get("name", ""), args=data.get("args", {}))
            except json.JSONDecodeError:
                logger.warning("tool_call JSONパース失敗: %s", match.group(1))

        # <final_answer> タグ
        fa_match = re.search(r"<final_answer>(.*?)</final_answer>", buffer, re.DOTALL)
        if fa_match:
            content = fa_match.group(1).strip()
        else:
            # タグなし = 最終回答
            content = buffer

        # <think> タグ抽出
        think_match = re.search(r"<think>(.*?)</think>", content, re.DOTALL)
        think_content = ""
        if think_match:
            think_content = think_match.group(1).strip()
            content = content.replace(think_match.group(0), "").strip()

        return FinalAnswer(content=content, think_content=think_content)
