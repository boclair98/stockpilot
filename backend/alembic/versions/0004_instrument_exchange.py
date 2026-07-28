"""identify positions and orders by symbol plus exchange

Revision ID: 0004_instrument_exchange
Revises: 0003_dual_currency
"""

import sqlalchemy as sa
from alembic import op

revision = "0004_instrument_exchange"
down_revision = "0003_dual_currency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "positions",
        sa.Column("exchange", sa.String(8), nullable=False, server_default="KRX"),
    )
    op.add_column(
        "trade_orders",
        sa.Column("exchange", sa.String(8), nullable=False, server_default="KRX"),
    )
    op.drop_constraint("positions_owner_id_symbol_key", "positions", type_="unique")
    op.create_unique_constraint(
        "uq_positions_owner_symbol_exchange",
        "positions",
        ["owner_id", "symbol", "exchange"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_positions_owner_symbol_exchange", "positions", type_="unique"
    )
    op.create_unique_constraint(
        "positions_owner_id_symbol_key", "positions", ["owner_id", "symbol"]
    )
    op.drop_column("trade_orders", "exchange")
    op.drop_column("positions", "exchange")
