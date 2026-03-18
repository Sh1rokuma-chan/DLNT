"""DB セッション管理"""
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def init_db():
    """起動時DB接続確認"""
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: None)  # 接続テスト


async def get_db():
    """FastAPI依存注入用DBセッション"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


# RAGツールからの直接利用用
async_session_factory = AsyncSessionLocal
