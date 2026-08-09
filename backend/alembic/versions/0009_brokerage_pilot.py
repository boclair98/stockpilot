"""add order replay protection and append-only audit events

Revision ID: 0009_brokerage_pilot
Revises: 0008_growth_hub
"""

import sqlalchemy as sa
from alembic import op

revision = "0009_brokerage_pilot"
down_revision = "0008_growth_hub"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "trade_orders", sa.Column("idempotency_key", sa.String(128), nullable=True)
    )
    op.add_column(
        "trade_orders", sa.Column("request_fingerprint", sa.String(64), nullable=True)
    )
    op.create_unique_constraint(
        "uq_trade_orders_owner_idempotency",
        "trade_orders",
        ["owner_id", "idempotency_key"],
    )
    op.create_table(
        "audit_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("actor_id", sa.UUID(), nullable=False),
        sa.Column("event_type", sa.String(48), nullable=False),
        sa.Column("entity_type", sa.String(32), nullable=False),
        sa.Column("entity_id", sa.UUID(), nullable=False),
        sa.Column("request_id", sa.String(64), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("actor_id", "event_type", "entity_id", "request_id", "created_at"):
        op.create_index(f"ix_audit_events_{column}", "audit_events", [column])


def downgrade() -> None:
    op.drop_table("audit_events")
    op.drop_constraint(
        "uq_trade_orders_owner_idempotency", "trade_orders", type_="unique"
    )
    op.drop_column("trade_orders", "request_fingerprint")
    op.drop_column("trade_orders", "idempotency_key")
