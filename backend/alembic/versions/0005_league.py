"""add privacy-first paper-investing league

Revision ID: 0005_league
Revises: 0004_instrument_exchange
"""

import sqlalchemy as sa
from alembic import op

revision = "0005_league"
down_revision = "0004_instrument_exchange"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "league_participants",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("nickname", sa.String(24), nullable=False),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "active", sa.Boolean(), server_default=sa.true(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("nickname"),
        sa.UniqueConstraint("owner_id"),
    )
    op.create_index(
        "ix_league_participants_nickname",
        "league_participants",
        ["nickname"],
    )
    op.create_index(
        "ix_league_participants_owner_id",
        "league_participants",
        ["owner_id"],
    )
    op.create_table(
        "league_rank_snapshots",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("participant_id", sa.UUID(), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("return_rate", sa.Numeric(12, 6), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["participant_id"],
            ["league_participants.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "participant_id",
            "snapshot_date",
            name="uq_league_snapshot_participant_date",
        ),
    )
    op.create_index(
        "ix_league_rank_snapshots_participant_id",
        "league_rank_snapshots",
        ["participant_id"],
    )
    op.create_index(
        "ix_league_rank_snapshots_snapshot_date",
        "league_rank_snapshots",
        ["snapshot_date"],
    )


def downgrade() -> None:
    op.drop_table("league_rank_snapshots")
    op.drop_table("league_participants")
