"""会話CRUD ルーター"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from app.db import crud
from app.db.session import get_db
from app.models.schemas import ConversationCreate, ConversationOut, MessageOut
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()


@router.post("/", response_model=ConversationOut, status_code=201)
async def create_conversation(body: ConversationCreate, db: AsyncSession = Depends(get_db)):
    conv = await crud.create_conversation(
        db,
        agent_type=body.agent_type,
        title=body.title,
        workspace_id=body.workspace_id,
    )
    return conv


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


@router.get("/{conversation_id}/messages", response_model=list[MessageOut])
async def get_messages(
    conversation_id: uuid.UUID,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    return await crud.get_conversation_messages(db, conversation_id, limit=limit)
