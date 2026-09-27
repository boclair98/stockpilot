"""Equal-bankroll private friend challenges.

Revision ID: 0016_friend_challenge
Revises: 0015_toss_game
"""

from alembic import op
import sqlalchemy as sa

revision = "0016_friend_challenge"
down_revision = "0015_toss_game"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("league_rooms", sa.Column("duration_days", sa.Integer(), nullable=False, server_default="7"))
    op.create_table(
        "challenge_accounts",
        sa.Column("room_id", sa.UUID(), sa.ForeignKey("league_rooms.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("owner_id", sa.UUID(), primary_key=True),
        sa.Column("cash_krw", sa.Numeric(18, 2), nullable=False),
        sa.CheckConstraint("cash_krw >= 0", name="ck_challenge_cash_nonnegative"),
    )
    op.create_table(
        "challenge_positions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("room_id", sa.UUID(), sa.ForeignKey("league_rooms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("symbol", sa.String(12), nullable=False),
        sa.Column("exchange", sa.String(8), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("average_price", sa.Numeric(18, 4), nullable=False),
        sa.UniqueConstraint("room_id", "owner_id", "symbol", "exchange", name="uq_challenge_position"),
        sa.CheckConstraint("quantity > 0", name="ck_challenge_position_quantity"),
    )
    op.create_index("ix_challenge_positions_room_owner", "challenge_positions", ["room_id", "owner_id"])
    op.create_table(
        "challenge_orders",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("room_id", sa.UUID(), sa.ForeignKey("league_rooms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("request_key", sa.String(80), nullable=False),
        sa.Column("symbol", sa.String(12), nullable=False),
        sa.Column("exchange", sa.String(8), nullable=False),
        sa.Column("side", sa.String(4), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("fill_price", sa.Numeric(18, 4), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("room_id", "owner_id", "request_key", name="uq_challenge_order_request"),
        sa.CheckConstraint("quantity > 0", name="ck_challenge_order_quantity"),
    )
    op.create_index("ix_challenge_orders_room_owner_created", "challenge_orders", ["room_id", "owner_id", "created_at"])


def downgrade() -> None:
    op.drop_table("challenge_orders")
    op.drop_table("challenge_positions")
    op.drop_table("challenge_accounts")
    op.drop_column("league_rooms", "duration_days")
