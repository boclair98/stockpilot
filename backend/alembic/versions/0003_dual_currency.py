"""add KRW virtual cash balance

Revision ID: 0003_dual_currency
Revises: 0002_trading
"""

import sqlalchemy as sa
from alembic import op

revision = "0003_dual_currency"
down_revision = "0002_trading"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "trading_accounts",
        sa.Column(
            "cash_krw",
            sa.Numeric(18, 0),
            nullable=False,
            server_default="100000000",
        ),
    )


def downgrade() -> None:
    op.drop_column("trading_accounts", "cash_krw")
