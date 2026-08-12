"""add institutional trading controls and reconciliation runs

Revision ID: 0010_institutional_controls
Revises: 0009_brokerage_pilot
"""

import sqlalchemy as sa
from alembic import op

revision = "0010_institutional_controls"
down_revision = "0009_brokerage_pilot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("trade_orders", sa.Column("risk_code", sa.String(32)))
    op.add_column("trade_orders", sa.Column("reject_reason", sa.String(200)))
    op.create_table(
        "trading_controls",
        sa.Column("scope", sa.String(16), nullable=False),
        sa.Column("halted", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("halt_reason", sa.String(200), nullable=True),
        sa.Column("max_order_notional_krw", sa.Numeric(18, 0), nullable=False),
        sa.Column("max_order_notional_usd", sa.Numeric(18, 2), nullable=False),
        sa.Column("max_open_orders", sa.Integer(), nullable=False),
        sa.Column("max_daily_orders", sa.Integer(), nullable=False),
        sa.Column("updated_by", sa.UUID(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("scope"),
    )
    op.create_table(
        "reconciliation_runs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("account_count", sa.Integer(), nullable=False),
        sa.Column("order_count", sa.Integer(), nullable=False),
        sa.Column("position_count", sa.Integer(), nullable=False),
        sa.Column("discrepancy_count", sa.Integer(), nullable=False),
        sa.Column("cash_krw_total", sa.Numeric(24, 0), nullable=False),
        sa.Column("cash_usd_total", sa.Numeric(24, 2), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("initiated_by", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.bulk_insert(
        sa.table(
            "trading_controls",
            sa.column("scope", sa.String()),
            sa.column("halted", sa.Boolean()),
            sa.column("max_order_notional_krw", sa.Numeric()),
            sa.column("max_order_notional_usd", sa.Numeric()),
            sa.column("max_open_orders", sa.Integer()),
            sa.column("max_daily_orders", sa.Integer()),
        ),
        [
            {
                "scope": "GLOBAL",
                "halted": False,
                "max_order_notional_krw": 100_000_000,
                "max_order_notional_usd": 100_000,
                "max_open_orders": 20,
                "max_daily_orders": 200,
            }
        ],
    )
    op.create_index(
        "ix_reconciliation_runs_initiated_by",
        "reconciliation_runs",
        ["initiated_by"],
    )
    op.create_index(
        "ix_reconciliation_runs_created_at",
        "reconciliation_runs",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_table("reconciliation_runs")
    op.drop_table("trading_controls")
    op.drop_column("trade_orders", "reject_reason")
    op.drop_column("trade_orders", "risk_code")
