"""add investor tools, advanced orders, and private leagues

Revision ID: 0006_investor_tools
Revises: 0005_league
"""

import sqlalchemy as sa
from alembic import op

revision = "0006_investor_tools"
down_revision = "0005_league"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "trade_orders",
        "order_type",
        existing_type=sa.String(8),
        type_=sa.String(12),
        existing_nullable=False,
    )
    op.add_column(
        "trade_orders", sa.Column("trigger_price", sa.Numeric(18, 4), nullable=True)
    )
    op.add_column(
        "trade_orders",
        sa.Column("fee", sa.Numeric(18, 4), server_default="0", nullable=False),
    )
    op.add_column(
        "trade_orders",
        sa.Column("tax", sa.Numeric(18, 4), server_default="0", nullable=False),
    )
    op.add_column(
        "trade_orders", sa.Column("realized_pnl", sa.Numeric(18, 4), nullable=True)
    )

    op.create_table(
        "watchlist_items",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("symbol", sa.String(12), nullable=False),
        sa.Column("exchange", sa.String(8), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "owner_id",
            "symbol",
            "exchange",
            name="uq_watchlist_owner_symbol_exchange",
        ),
    )
    op.create_index("ix_watchlist_items_owner_id", "watchlist_items", ["owner_id"])

    op.create_table(
        "price_alerts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("symbol", sa.String(12), nullable=False),
        sa.Column("exchange", sa.String(8), nullable=False),
        sa.Column("direction", sa.String(5), nullable=False),
        sa.Column("target_price", sa.Numeric(18, 4), nullable=False),
        sa.Column(
            "status",
            sa.String(12),
            server_default="ACTIVE",
            nullable=False,
        ),
        sa.Column("triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_price_alerts_owner_id", "price_alerts", ["owner_id"])

    op.create_table(
        "portfolio_daily_snapshots",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("equity_krw", sa.Numeric(18, 2), nullable=False),
        sa.Column("equity_usd", sa.Numeric(18, 4), nullable=False),
        sa.Column("return_rate", sa.Numeric(12, 6), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "owner_id",
            "snapshot_date",
            name="uq_portfolio_snapshot_owner_date",
        ),
    )
    op.create_index(
        "ix_portfolio_daily_snapshots_owner_id",
        "portfolio_daily_snapshots",
        ["owner_id"],
    )
    op.create_index(
        "ix_portfolio_daily_snapshots_snapshot_date",
        "portfolio_daily_snapshots",
        ["snapshot_date"],
    )

    op.create_table(
        "league_rooms",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(32), nullable=False),
        sa.Column("invite_code", sa.String(10), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("invite_code"),
    )
    op.create_index("ix_league_rooms_owner_id", "league_rooms", ["owner_id"])
    op.create_index("ix_league_rooms_invite_code", "league_rooms", ["invite_code"])

    op.create_table(
        "league_room_members",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("league_id", sa.UUID(), nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("nickname", sa.String(24), nullable=False),
        sa.Column("baseline_krw", sa.Numeric(18, 2), nullable=False),
        sa.Column("baseline_usd", sa.Numeric(18, 4), nullable=False),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["league_id"], ["league_rooms.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "league_id",
            "nickname",
            name="uq_league_room_member_nickname",
        ),
        sa.UniqueConstraint(
            "league_id",
            "owner_id",
            name="uq_league_room_member_owner",
        ),
    )
    op.create_index(
        "ix_league_room_members_league_id",
        "league_room_members",
        ["league_id"],
    )
    op.create_index(
        "ix_league_room_members_owner_id",
        "league_room_members",
        ["owner_id"],
    )


def downgrade() -> None:
    op.drop_table("league_room_members")
    op.drop_table("league_rooms")
    op.drop_table("portfolio_daily_snapshots")
    op.drop_table("price_alerts")
    op.drop_table("watchlist_items")
    op.drop_column("trade_orders", "realized_pnl")
    op.drop_column("trade_orders", "tax")
    op.drop_column("trade_orders", "fee")
    op.drop_column("trade_orders", "trigger_price")
    op.alter_column(
        "trade_orders",
        "order_type",
        existing_type=sa.String(12),
        type_=sa.String(8),
        existing_nullable=False,
    )
