"""Isolated fictional-price ledger for Apps in Toss.

Revision ID: 0015_toss_game
Revises: 0014_community_safety
"""

from alembic import op
import sqlalchemy as sa

revision = "0015_toss_game"
down_revision = "0014_community_safety"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "toss_game_accounts",
        sa.Column("owner_id", sa.UUID(), primary_key=True),
        sa.Column("cash_krw", sa.Numeric(18, 2), nullable=False),
        sa.Column("cash_usd", sa.Numeric(18, 2), nullable=False),
        sa.Column("nickname", sa.String(12), nullable=True, unique=True),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "toss_game_positions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("symbol", sa.String(12), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("average_price", sa.Numeric(18, 4), nullable=False),
        sa.UniqueConstraint("owner_id", "symbol", name="uq_toss_game_position_owner_symbol"),
        sa.CheckConstraint("quantity > 0", name="ck_toss_game_position_quantity"),
    )
    op.create_index("ix_toss_game_positions_owner_id", "toss_game_positions", ["owner_id"])
    op.create_table(
        "toss_game_orders",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("request_key", sa.String(80), nullable=False),
        sa.Column("symbol", sa.String(12), nullable=False),
        sa.Column("side", sa.String(4), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("fill_price", sa.Numeric(18, 4), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("owner_id", "request_key", name="uq_toss_game_order_request"),
        sa.CheckConstraint("quantity > 0", name="ck_toss_game_order_quantity"),
    )
    op.create_index("ix_toss_game_orders_owner_id", "toss_game_orders", ["owner_id"])
    op.create_index("ix_toss_game_orders_owner_created", "toss_game_orders", ["owner_id", "created_at"])


def downgrade() -> None:
    op.drop_table("toss_game_orders")
    op.drop_table("toss_game_positions")
    op.drop_table("toss_game_accounts")
