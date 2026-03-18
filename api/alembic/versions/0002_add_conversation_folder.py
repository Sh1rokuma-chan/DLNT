"""Add folder column to conversations

Revision ID: 0002
Revises: 0001
Create Date: 2026-03-18

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("conversations", sa.Column("folder", sa.Text, nullable=True))
    op.create_index("idx_conversations_folder", "conversations", ["folder"])


def downgrade() -> None:
    op.drop_index("idx_conversations_folder")
    op.drop_column("conversations", "folder")
