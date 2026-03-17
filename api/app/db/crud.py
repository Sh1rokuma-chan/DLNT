"""DB CRUD操作"""
import uuid
from typing import Optional

from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Conversation, Message, Workspace


# ─────────────────────────────────────────────────────────
# Workspace
# ─────────────────────────────────────────────────────────

async def get_default_workspace(db: AsyncSession) -> Workspace:
    result = await db.execute(select(Workspace).where(Workspace.name == "Default"))
    ws = result.scalar_one_or_none()
    if ws is None:
        ws = Workspace(name="Default", description="デフォルトワークスペース")
        db.add(ws)
        await db.commit()
        await db.refresh(ws)
    return ws


# ─────────────────────────────────────────────────────────
# Conversation
# ─────────────────────────────────────────────────────────

async def create_conversation(
    db: AsyncSession,
    agent_type: str = "scout",
    title: str = "新しい会話",
    workspace_id: Optional[uuid.UUID] = None,
) -> Conversation:
    conv = Conversation(agent_type=agent_type, title=title, workspace_id=workspace_id)
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return conv


async def get_conversation(db: AsyncSession, conversation_id: uuid.UUID) -> Optional[Conversation]:
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == conversation_id)
        .options(selectinload(Conversation.messages))
    )
    return result.scalar_one_or_none()


async def list_conversations(
    db: AsyncSession,
    workspace_id: Optional[uuid.UUID] = None,
    limit: int = 50,
) -> list[Conversation]:
    q = select(Conversation).order_by(desc(Conversation.updated_at)).limit(limit)
    if workspace_id:
        q = q.where(Conversation.workspace_id == workspace_id)
    result = await db.execute(q)
    return list(result.scalars().all())


async def update_conversation_title(db: AsyncSession, conversation_id: uuid.UUID, title: str) -> None:
    conv = await db.get(Conversation, conversation_id)
    if conv:
        conv.title = title
        await db.commit()


# ─────────────────────────────────────────────────────────
# Message
# ─────────────────────────────────────────────────────────

async def create_message(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    role: str,
    content: str,
    think_content: Optional[str] = None,
    tool_calls: Optional[list] = None,
) -> Message:
    msg = Message(
        conversation_id=conversation_id,
        role=role,
        content=content,
        think_content=think_content,
        tool_calls=tool_calls,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return msg


async def get_conversation_messages(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    limit: int = 100,
) -> list[Message]:
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
        .limit(limit)
    )
    return list(result.scalars().all())
