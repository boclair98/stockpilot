"""add execution quality and OCO protection plans

Revision ID: 0011_execution_protection
Revises: 0010_institutional_controls
"""

import sqlalchemy as sa
from alembic import op

revision = "0011_execution_protection"
down_revision = "0010_institutional_controls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("trade_orders", sa.Column("reference_price", sa.Numeric(18, 4)))
    op.add_column("trade_orders", sa.Column("spread_bps", sa.Numeric(10, 4)))
    op.add_column("trade_orders", sa.Column("slippage_bps", sa.Numeric(10, 4)))
    op.add_column("trade_orders", sa.Column("participation_rate", sa.Numeric(12, 8)))
    op.create_table(
        "protection_plans",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("symbol", sa.String(12), nullable=False),
        sa.Column("exchange", sa.String(8), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 6), nullable=False),
        sa.Column("take_profit_price", sa.Numeric(18, 4), nullable=False),
        sa.Column("stop_loss_price", sa.Numeric(18, 4), nullable=False),
        sa.Column("status", sa.String(12), server_default="ACTIVE", nullable=False),
        sa.Column("trigger_reason", sa.String(16)),
        sa.Column("exit_order_id", sa.UUID()),
        sa.Column("triggered_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("quantity > 0", name="ck_protection_quantity_positive"),
        sa.CheckConstraint(
            "status IN ('ACTIVE', 'TRIGGERED', 'FILLED', 'FAILED', 'CANCELED')",
            name="ck_protection_status",
        ),
        sa.CheckConstraint(
            "take_profit_price > stop_loss_price",
            name="ck_protection_price_order",
        ),
        sa.ForeignKeyConstraint(
            ["exit_order_id"], ["trade_orders.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_protection_plans_owner_id", "protection_plans", ["owner_id"])
    op.create_index(
        "ix_protection_active_symbol",
        "protection_plans",
        ["status", "symbol", "exchange"],
    )


def downgrade() -> None:
    op.drop_table("protection_plans")
    op.drop_column("trade_orders", "participation_rate")
    op.drop_column("trade_orders", "slippage_bps")
    op.drop_column("trade_orders", "spread_bps")
    op.drop_column("trade_orders", "reference_price")

