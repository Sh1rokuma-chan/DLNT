"""会話CRUD ルーター"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import crud
from app.db.models import Conversation
from app.db.session import get_db
from app.models.schemas import ConversationCreate, ConversationOut, MessageOut
from pydantic import BaseModel

router = APIRouter()


class TitleUpdate(BaseModel):
    title: str


class FolderUpdate(BaseModel):
    folder: str | None = None


@router.post("/", response_model=ConversationOut, status_code=201)
async def create_conversation(body: ConversationCreate, db: AsyncSession = Depends(get_db)):
    conv = await crud.create_conversation(
        db,
        agent_type=body.agent_type,
        title=body.title,
        workspace_id=body.workspace_id,
    )
    return conv


@router.get("/search", response_model=list[ConversationOut])
async def search_conversations(
    q: str,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """会話タイトルを全文検索"""
    result = await db.execute(
        select(Conversation)
        .where(Conversation.title.ilike(f"%{q}%"))
        .order_by(Conversation.updated_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


@router.get("/", response_model=list[ConversationOut])
async def list_conversations(
    workspace_id: Optional[uuid.UUID] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    return await crud.list_conversations(db, workspace_id=workspace_id, limit=limit)


@router.get("/{conversation_id}", response_model=ConversationOut)
async def get_conversation(conversation_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    conv = await crud.get_conversation(db, conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="会話が見つかりません")
    return conv


@router.patch("/{conversation_id}/title", status_code=204)
async def update_title(
    conversation_id: uuid.UUID,
    body: TitleUpdate,
    db: AsyncSession = Depends(get_db),
):
    await crud.update_conversation_title(db, conversation_id, body.title)


@router.patch("/{conversation_id}/folder", status_code=204)
async def update_folder(
    conversation_id: uuid.UUID,
    body: FolderUpdate,
    db: AsyncSession = Depends(get_db),
):
    conv = await db.get(Conversation, conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="会話が見つかりません")
    conv.folder = body.folder
    await db.commit()


@router.get("/folders/list", response_model=list[str])
async def list_folders(db: AsyncSession = Depends(get_db)):
    """使用中のフォルダ名一覧を返す"""
    result = await db.execute(
        select(Conversation.folder)
        .where(Conversation.folder.isnot(None))
        .distinct()
        .order_by(Conversation.folder)
    )
    return [row[0] for row in result.all()]


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation(conversation_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    conv = await db.get(Conversation, conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="会話が見つかりません")
    await db.delete(conv)
    await db.commit()


@router.get("/{conversation_id}/messages", response_model=list[MessageOut])
async def get_messages(
    conversation_id: uuid.UUID,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    return await crud.get_conversation_messages(db, conversation_id, limit=limit)
