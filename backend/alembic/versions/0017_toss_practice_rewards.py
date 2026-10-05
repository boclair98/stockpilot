"""Add opt-in noncompetitive practice rounds without changing existing ledgers."""
from alembic import op
import sqlalchemy as sa

revision = "0017_toss_practice_rewards"
down_revision = "0016_friend_challenge"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("toss_practice_states",
        sa.Column("owner_id", sa.UUID(), primary_key=True),
        sa.Column("active_round_id", sa.UUID()),
        sa.Column("selected_scope", sa.String(8), nullable=False, server_default="original"),
        sa.Column("last_reset_at", sa.DateTime(timezone=True)))
    op.create_table("toss_practice_rounds",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("ledger_owner_id", sa.UUID(), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_toss_practice_owner_created", "toss_practice_rounds", ["owner_id", "created_at"])
    op.create_table("toss_practice_reward_tickets",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("request_key", sa.String(128), nullable=False),
        sa.Column("ad_group_id", sa.String(100), nullable=False),
        sa.Column("round_id", sa.UUID(), sa.ForeignKey("toss_practice_rounds.id")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("owner_id", "request_key", name="uq_toss_practice_ticket_request"))
    op.create_index("ix_toss_practice_ticket_owner_created", "toss_practice_reward_tickets", ["owner_id", "created_at"])


def downgrade():
    # Explicit operator migration only. Never used by an end-user reset.
    op.drop_table("toss_practice_reward_tickets")
    op.drop_table("toss_practice_rounds")
    op.drop_table("toss_practice_states")
