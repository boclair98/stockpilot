"""paper trading tables"""
from alembic import op
import sqlalchemy as sa

revision = "0002_trading"
down_revision = "0001"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("trading_accounts", sa.Column("owner_id", sa.UUID(), primary_key=True),
                    sa.Column("cash", sa.Numeric(18,2), nullable=False, server_default="100000"))
    op.create_table("positions", sa.Column("id", sa.UUID(), primary_key=True),
                    sa.Column("owner_id", sa.UUID(), nullable=False), sa.Column("symbol", sa.String(12), nullable=False),
                    sa.Column("quantity", sa.Numeric(18,6), nullable=False), sa.Column("average_price", sa.Numeric(18,4), nullable=False),
                    sa.UniqueConstraint("owner_id","symbol"))
    op.create_index("ix_positions_owner_id","positions",["owner_id"])
    op.create_table("trade_orders", sa.Column("id", sa.UUID(), primary_key=True),
                    sa.Column("owner_id", sa.UUID(), nullable=False), sa.Column("symbol", sa.String(12), nullable=False),
                    sa.Column("side", sa.String(4), nullable=False), sa.Column("order_type", sa.String(8), nullable=False),
                    sa.Column("quantity", sa.Numeric(18,6), nullable=False), sa.Column("limit_price", sa.Numeric(18,4)),
                    sa.Column("fill_price", sa.Numeric(18,4)), sa.Column("status", sa.String(12), nullable=False),
                    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_index("ix_trade_orders_owner_id","trade_orders",["owner_id"])

def downgrade():
    op.drop_table("trade_orders"); op.drop_table("positions"); op.drop_table("trading_accounts")
