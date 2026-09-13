"""add privacy-minimal paid-plan interest tracking

Revision ID: 0013_billing_foundation
Revises: 0012_scale_hot_paths
"""

from alembic import op
import sqlalchemy as sa


revision = "0013_billing_foundation"
down_revision = "0012_scale_hot_paths"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "billing_interests",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("plan_id", sa.String(length=12), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "owner_id", "plan_id", name="uq_billing_interests_owner_plan"
        ),
    )
    op.create_index(
        "ix_billing_interests_owner_id", "billing_interests", ["owner_id"]
    )
    op.create_index(
        "ix_billing_interests_plan_created_at",
        "billing_interests",
        ["plan_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_billing_interests_plan_created_at", table_name="billing_interests"
    )
    op.drop_index("ix_billing_interests_owner_id", table_name="billing_interests")
    op.drop_table("billing_interests")
