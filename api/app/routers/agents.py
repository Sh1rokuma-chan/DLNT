"""エージェント管理ルーター"""
from fastapi import APIRouter

from app.agent.agents import list_agents
from app.config import get_settings
from app.models.schemas import AgentInfo

router = APIRouter()
settings = get_settings()


@router.get("/", response_model=list[AgentInfo])
async def get_agents():
    return [
        AgentInfo(
            id=a.id,
            name=a.name,
            icon=a.icon,
            description=a.description,
            tools=a.primary_tools,
            model=settings.ollama_model,
            status="online",
        )
        for a in list_agents()
    ]


@router.get("/{agent_id}", response_model=AgentInfo)
async def get_agent(agent_id: str):
    from app.agent.agents import get_agent as _get_agent
    a = _get_agent(agent_id)
    return AgentInfo(
        id=a.id,
        name=a.name,
        icon=a.icon,
        description=a.description,
        tools=a.primary_tools,
        model=settings.ollama_model,
        status="online",
    )
