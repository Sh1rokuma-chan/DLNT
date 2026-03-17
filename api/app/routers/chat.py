"""WebSocket チャットルーター + REST チャットエンドポイント"""
import json
import logging
import uuid

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.engine import route_agent, run_agent
from app.db import crud
from app.db.session import get_db
from app.llm.ollama import OllamaProvider
from app.models.schemas import ChatRequest

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/ws/chat/{conversation_id}")
async def websocket_chat(
    websocket: WebSocket,
    conversation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    WebSocket チャットエンドポイント。

    クライアント送信:
      {"message": "ユーザーの質問", "agent_type": "scout"}

    サーバー送出 (JSON Lines):
      {"type": "think_start"}
      {"type": "think_token", "content": "..."}
      {"type": "tool_call", "name": "web_search", "args": {...}}
      {"type": "tool_result", "name": "web_search", "success": true, "summary": "...", "elapsed": 1.2}
      {"type": "answer_token", "content": "..."}
      {"type": "done", "total_elapsed": 4.3, "tools_used": 2}
    """
    await websocket.accept()
    logger.info("WebSocket接続: conversation_id=%s", conversation_id)

    conv = await crud.get_conversation(db, conversation_id)
    if not conv:
        await websocket.send_text(json.dumps({"type": "error", "message": "会話が見つかりません"}))
        await websocket.close()
        return

    llm = OllamaProvider()
    answer_buffer = ""

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            user_message = data.get("message", "")
            agent_type = data.get("agent_type", conv.agent_type)

            if not user_message.strip():
                continue

            # 自動ルーティング
            if agent_type == "auto":
                agent_type = await route_agent(user_message, llm)
                await websocket.send_text(json.dumps({
                    "type": "route",
                    "agent": agent_type,
                    "message": f"{agent_type} に転送しました",
                }))

            # ユーザーメッセージ保存
            await crud.create_message(db, conversation_id, "user", user_message)

            # 会話履歴取得 (最新50件)
            msgs = await crud.get_conversation_messages(db, conversation_id, limit=50)
            history = [
                {"role": m.role if m.role in ("user", "assistant") else "user", "content": m.content}
                for m in msgs[:-1]  # 直前のユーザーメッセージを除く
            ]

            # ReActループ実行
            think_content = ""
            tool_calls_log = []
            answer_buffer = ""

            async for event in run_agent(user_message, agent_type, history):
                await websocket.send_text(json.dumps(event, ensure_ascii=False))

                if event["type"] == "think_token":
                    think_content += event["content"]
                elif event["type"] == "answer_token":
                    answer_buffer += event["content"]
                elif event["type"] == "tool_call":
                    tool_calls_log.append({
                        "name": event["name"],
                        "args": event["args"],
                    })
                elif event["type"] == "tool_result":
                    if tool_calls_log:
                        tool_calls_log[-1].update({
                            "success": event["success"],
                            "summary": event["summary"],
                            "elapsed": event["elapsed"],
                        })

            # アシスタントメッセージ保存
            if answer_buffer:
                await crud.create_message(
                    db,
                    conversation_id,
                    "assistant",
                    answer_buffer,
                    think_content=think_content or None,
                    tool_calls=tool_calls_log or None,
                )

    except WebSocketDisconnect:
        logger.info("WebSocket切断: conversation_id=%s", conversation_id)
    except Exception as e:
        logger.error("WebSocketエラー: %s", e)
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass


@router.post("/api/chat")
async def rest_chat(body: ChatRequest, db: AsyncSession = Depends(get_db)):
    """
    REST チャットエンドポイント (非ストリーミング、テスト用)。
    """
    llm = OllamaProvider()

    # 会話作成または取得
    if body.conversation_id:
        conv = await crud.get_conversation(db, body.conversation_id)
        if not conv:
            conv = await crud.create_conversation(db, agent_type=body.agent_type)
    else:
        conv = await crud.create_conversation(db, agent_type=body.agent_type)

    agent_type = body.agent_type
    if agent_type == "auto":
        agent_type = await route_agent(body.message, llm)

    # ユーザーメッセージ保存
    await crud.create_message(db, conv.id, "user", body.message)

    # 履歴取得
    msgs = await crud.get_conversation_messages(db, conv.id, limit=50)
    history = [
        {"role": m.role if m.role in ("user", "assistant") else "user", "content": m.content}
        for m in msgs[:-1]
    ]

    # エージェント実行 (全イベント収集)
    events = []
    answer = ""
    think_content = ""
    tool_calls_log = []

    async for event in run_agent(body.message, agent_type, history):
        events.append(event)
        if event["type"] == "answer_token":
            answer += event["content"]
        elif event["type"] == "think_token":
            think_content += event["content"]
        elif event["type"] == "tool_call":
            tool_calls_log.append({"name": event["name"], "args": event["args"]})
        elif event["type"] == "tool_result" and tool_calls_log:
            tool_calls_log[-1].update({
                "success": event["success"],
                "summary": event["summary"],
                "elapsed": event["elapsed"],
            })

    # 保存
    if answer:
        await crud.create_message(
            db, conv.id, "assistant", answer,
            think_content=think_content or None,
            tool_calls=tool_calls_log or None,
        )

    done_event = next((e for e in events if e["type"] == "done"), {})

    return {
        "conversation_id": str(conv.id),
        "agent": agent_type,
        "answer": answer,
        "think": think_content,
        "tool_calls": tool_calls_log,
        "total_elapsed": done_event.get("total_elapsed"),
        "tools_used": done_event.get("tools_used", 0),
    }
