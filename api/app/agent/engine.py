"""ReActループエンジン — Thought / Action / Observation"""
import json
import logging
import time
from typing import AsyncIterator

from app.agent.agents import AgentDefinition, get_agent
from app.agent.parser import FinalAnswer, ToolCall, ToolCallParser
from app.agent.prompts import ROUTING_PROMPT, SYSTEM_PROMPT_TEMPLATE
from app.config import get_settings
from app.llm.ollama import OllamaProvider
from app.tools.registry import get_registry

logger = logging.getLogger(__name__)
settings = get_settings()

parser = ToolCallParser()


def _build_system_prompt(agent: AgentDefinition) -> str:
    registry = get_registry()
    tool_defs = json.dumps(
        [t.to_ollama_tool()["function"] for t in registry.all()],
        ensure_ascii=False,
        indent=2,
    )
    return SYSTEM_PROMPT_TEMPLATE.format(
        agent_name=f"{agent.icon} {agent.name}",
        agent_description=agent.description,
        tool_definitions=tool_defs,
    ) + f"\n{agent.system_addendum}"


async def route_agent(message: str, llm: OllamaProvider) -> str:
    """メッセージを分析して最適なエージェントIDを返す"""
    prompt = ROUTING_PROMPT.format(message=message)
    try:
        response = await llm.chat_complete([{"role": "user", "content": prompt}])
        data = json.loads(response.strip())
        agent_id = data.get("agent", "scout")
        if agent_id not in ("scout", "coder", "archivist", "scribe"):
            return "scout"
        return agent_id
    except Exception:
        return "scout"


async def run_agent(
    user_message: str,
    agent_id: str,
    history: list[dict],
) -> AsyncIterator[dict]:
    """
    ReActループを実行し、WebSocket送出用のイベントをyieldする。

    イベント形式:
      {"type": "think_start"}
      {"type": "think_token", "content": "..."}
      {"type": "think_end"}
      {"type": "tool_call", "name": "...", "args": {...}}
      {"type": "tool_result", "name": "...", "success": bool, "summary": "...", "elapsed": float}
      {"type": "answer_token", "content": "..."}
      {"type": "done", "total_elapsed": float, "tools_used": int}
      {"type": "error", "message": "..."}
    """
    start_time = time.time()
    agent = get_agent(agent_id)
    registry = get_registry()
    llm = OllamaProvider()

    system_prompt = _build_system_prompt(agent)
    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    tools_used = 0
    max_iter = settings.react_max_iterations

    for iteration in range(max_iter):
        logger.info("ReAct iteration %d/%d (agent=%s)", iteration + 1, max_iter, agent_id)

        # LLM呼び出し（ストリーミング）
        buffer = ""
        in_think = False

        async for token in llm.chat(messages, stream=True):
            buffer += token

            # <think> タグ検出
            if "<think>" in buffer and not in_think:
                in_think = True
                yield {"type": "think_start"}

            if in_think:
                if "</think>" in buffer:
                    in_think = False
                    yield {"type": "think_end"}
                else:
                    yield {"type": "think_token", "content": token}
                continue

            # tool_call JSON (native) の場合は即終了してパース
            if buffer.strip().startswith('{"tool_calls":'):
                break

        # バッファをパース
        result = parser.parse_streaming_buffer(buffer)

        if isinstance(result, ToolCall):
            tool = registry.get(result.name)
            if not tool:
                yield {"type": "error", "message": f"ツール '{result.name}' が見つかりません"}
                break

            yield {"type": "tool_call", "name": result.name, "args": result.args}

            t0 = time.time()
            tool_result = await tool.execute(result.args)
            elapsed = round(time.time() - t0, 2)
            tools_used += 1

            yield {
                "type": "tool_result",
                "name": result.name,
                "success": tool_result.success,
                "summary": tool_result.display,
                "elapsed": elapsed,
            }

            # ツール結果をコンテキストに追加
            messages.append({"role": "assistant", "content": buffer})
            obs = json.dumps({"result": tool_result.data, "error": tool_result.error}, ensure_ascii=False)
            messages.append({
                "role": "tool",
                "content": f"<tool_result>{obs}</tool_result>",
            })

        elif isinstance(result, FinalAnswer):
            # 最終回答をトークン単位でストリーム
            for char in result.content:
                yield {"type": "answer_token", "content": char}
            break

    total_elapsed = round(time.time() - start_time, 2)
    yield {"type": "done", "total_elapsed": total_elapsed, "tools_used": tools_used}
