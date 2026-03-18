"""Pydantic スキーマ定義"""
import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


# ─────────────────────────────────────────────────────────
# Workspace
# ─────────────────────────────────────────────────────────

class WorkspaceOut(BaseModel):
    id: uuid.UUID
    name: str
    description: Optional[str]
    rag_directories: list[str]
    created_at: datetime

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────────
# Conversation
# ─────────────────────────────────────────────────────────

class ConversationCreate(BaseModel):
    agent_type: str = "scout"
    title: str = "新しい会話"
    workspace_id: Optional[uuid.UUID] = None
    folder: Optional[str] = None


class ConversationOut(BaseModel):
    id: uuid.UUID
    workspace_id: Optional[uuid.UUID]
    agent_type: str
    title: str
    pinned: bool
    folder: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────────
# Message
# ─────────────────────────────────────────────────────────

class MessageOut(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    role: str
    content: str
    think_content: Optional[str]
    tool_calls: Optional[list[Any]]
    created_at: datetime

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────────
# Chat (WebSocket)
# ─────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    agent_type: str = "scout"
    conversation_id: Optional[uuid.UUID] = None


# ─────────────────────────────────────────────────────────
# Agent
# ─────────────────────────────────────────────────────────

class AgentInfo(BaseModel):
    id: str
    name: str
    icon: str
    description: str
    primary_tools: list[str]
    model: str
    status: str = "online"


# ─────────────────────────────────────────────────────────
# System
# ─────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    version: str = "2.0.0"
    ollama: bool
    database: bool
