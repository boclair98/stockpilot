"""add daily challenges, trade journals, and duel rooms

Revision ID: 0008_growth_hub
Revises: 0007_firebase_push
"""

import sqlalchemy as sa
from alembic import op

revision = "0008_growth_hub"
down_revision = "0007_firebase_push"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "league_rooms",
        sa.Column("mode", sa.String(12), server_default="SEASON", nullable=False),
    )
    op.add_column(
        "league_rooms",
        sa.Column("max_members", sa.Integer(), server_default="100", nullable=False),
    )
    op.create_table(
        "daily_challenge_attempts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("challenge_date", sa.Date(), nullable=False),
        sa.Column("symbol", sa.String(12), nullable=False),
        sa.Column("exchange", sa.String(8), nullable=False),
        sa.Column("choice", sa.String(5), nullable=False),
        sa.Column("start_price", sa.Numeric(18, 4), nullable=False),
        sa.Column("end_price", sa.Numeric(18, 4), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "owner_id",
            "challenge_date",
            name="uq_daily_challenge_owner_date",
        ),
    )
    op.create_index(
        "ix_daily_challenge_attempts_owner_id",
        "daily_challenge_attempts",
        ["owner_id"],
    )
    op.create_index(
        "ix_daily_challenge_attempts_challenge_date",
        "daily_challenge_attempts",
        ["challenge_date"],
    )
    op.create_table(
        "trade_journals",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("symbol", sa.String(12), nullable=False),
        sa.Column("exchange", sa.String(8), nullable=False),
        sa.Column("thesis", sa.String(500), nullable=False),
        sa.Column("horizon", sa.String(12), nullable=False),
        sa.Column("target_return", sa.Numeric(8, 3), nullable=True),
        sa.Column("stop_loss", sa.Numeric(8, 3), nullable=True),
        sa.Column("confidence", sa.Integer(), nullable=False),
        sa.Column("review", sa.String(500), nullable=True),
        sa.Column("outcome", sa.String(12), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_trade_journals_owner_id", "trade_journals", ["owner_id"])


def downgrade() -> None:
    op.drop_table("trade_journals")
    op.drop_table("daily_challenge_attempts")
    op.drop_column("league_rooms", "max_members")
    op.drop_column("league_rooms", "mode")
