"""テキストエンベディング (sentence-transformers, lazy load)"""
import logging
from functools import lru_cache
from typing import List

logger = logging.getLogger(__name__)

_model = None


def _load_model():
    global _model
    if _model is None:
        try:
            from sentence_transformers import SentenceTransformer
            from app.config import get_settings
            settings = get_settings()
            logger.info("エンベディングモデルをロード中: %s", settings.embedding_model)
            _model = SentenceTransformer(settings.embedding_model)
            logger.info("エンベディングモデルのロード完了")
        except Exception as e:
            logger.warning("エンベディングモデルのロード失敗: %s", e)
            _model = None
    return _model


def embed_text(text: str) -> List[float] | None:
    """テキストを384次元ベクトルに変換。失敗時はNone。"""
    model = _load_model()
    if model is None:
        return None
    try:
        vec = model.encode(text, normalize_embeddings=True)
        return vec.tolist()
    except Exception as e:
        logger.error("embed_text失敗: %s", e)
        return None


def embed_batch(texts: List[str]) -> List[List[float] | None]:
    """複数テキストをバッチエンベディング。失敗したものはNone。"""
    model = _load_model()
    if model is None:
        return [None] * len(texts)
    try:
        vecs = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        return [v.tolist() for v in vecs]
    except Exception as e:
        logger.error("embed_batch失敗: %s", e)
        return [None] * len(texts)
