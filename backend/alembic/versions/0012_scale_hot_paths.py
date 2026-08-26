"""add composite indexes for high-traffic read and worker paths

Revision ID: 0012_scale_hot_paths
Revises: 0011_execution_protection
"""

from alembic import op

revision = "0012_scale_hot_paths"
down_revision = "0011_execution_protection"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # These indexes keep per-user risk checks and history queries bounded as
    # the order ledger grows.  Worker indexes make the status + oldest-first
    # polling scans index-only on the common path.
    op.create_index(
        "ix_trade_orders_owner_status", "trade_orders", ["owner_id", "status"]
    )
    op.create_index(
        "ix_trade_orders_owner_created_at",
        "trade_orders",
        ["owner_id", "created_at"],
    )
    op.create_index(
        "ix_trade_orders_owner_symbol_exchange_side_status",
        "trade_orders",
        ["owner_id", "symbol", "exchange", "side", "status"],
    )
    op.create_index(
        "ix_protection_plans_owner_status_symbol_exchange",
        "protection_plans",
        ["owner_id", "status", "symbol", "exchange"],
    )
    op.create_index(
        "ix_protection_plans_status_created_at",
        "protection_plans",
        ["status", "created_at"],
    )
    op.create_index(
        "ix_price_alerts_status_created_at",
        "price_alerts",
        ["status", "created_at"],
    )
    op.create_index(
        "ix_price_alerts_owner_status_created_at",
        "price_alerts",
        ["owner_id", "status", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_price_alerts_owner_status_created_at", table_name="price_alerts")
    op.drop_index("ix_price_alerts_status_created_at", table_name="price_alerts")
    op.drop_index(
        "ix_protection_plans_status_created_at", table_name="protection_plans"
    )
    op.drop_index(
        "ix_protection_plans_owner_status_symbol_exchange",
        table_name="protection_plans",
    )
    op.drop_index(
        "ix_trade_orders_owner_symbol_exchange_side_status",
        table_name="trade_orders",
    )
    op.drop_index("ix_trade_orders_owner_created_at", table_name="trade_orders")
    op.drop_index("ix_trade_orders_owner_status", table_name="trade_orders")

