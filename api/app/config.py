"""DLNT v2 設定管理"""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://dlnt:changeme@localhost:5432/dlnt"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # Ollama
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "gpt-oss:20b"
    ollama_timeout: int = 120

    # External services
    searxng_url: str = "http://searxng:8080"
    whisper_url: str = "http://whisper-api:8000"

    # Agent settings
    react_max_iterations: int = 8
    react_timeout: int = 300  # 5分

    # File paths
    documents_path: str = "/mnt/user/documents"
    workspace_path: str = "/app/workspace"

    # Embedding model (384-dim, multilingual)
    embedding_model: str = "intfloat/multilingual-e5-small"
    embedding_dim: int = 384

    # Logging
    log_level: str = "info"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()
