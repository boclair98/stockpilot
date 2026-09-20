"""add community reports and user blocks

Revision ID: 0014_community_safety
Revises: 0013_billing_foundation
"""

from alembic import op
import sqlalchemy as sa


revision = "0014_community_safety"
down_revision = "0013_billing_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "content_reports",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "post_id",
            sa.UUID(),
            sa.ForeignKey("posts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "reporter_id",
            sa.UUID(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "target_author_id",
            sa.UUID(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("reason", sa.String(length=32), nullable=False),
        sa.Column(
            "status", sa.String(length=16), server_default="PENDING", nullable=False
        ),
        sa.Column("resolved_by", sa.UUID(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "post_id", "reporter_id", name="uq_content_reports_post_reporter"
        ),
    )
    op.create_index("ix_content_reports_post_id", "content_reports", ["post_id"])
    op.create_index(
        "ix_content_reports_reporter_id", "content_reports", ["reporter_id"]
    )
    op.create_index(
        "ix_content_reports_target_author_id",
        "content_reports",
        ["target_author_id"],
    )
    op.create_index(
        "ix_content_reports_created_at", "content_reports", ["created_at"]
    )
    op.create_index(
        "ix_content_reports_status_created_at",
        "content_reports",
        ["status", "created_at"],
    )

    op.create_table(
        "user_blocks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "blocker_id",
            sa.UUID(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "blocked_id",
            sa.UUID(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "blocker_id", "blocked_id", name="uq_user_blocks_blocker_blocked"
        ),
        sa.CheckConstraint("blocker_id <> blocked_id", name="ck_user_blocks_not_self"),
    )
    op.create_index("ix_user_blocks_blocker_id", "user_blocks", ["blocker_id"])
    op.create_index("ix_user_blocks_blocked_id", "user_blocks", ["blocked_id"])


def downgrade() -> None:
    op.drop_index("ix_user_blocks_blocked_id", table_name="user_blocks")
    op.drop_index("ix_user_blocks_blocker_id", table_name="user_blocks")
    op.drop_table("user_blocks")
    op.drop_index(
        "ix_content_reports_status_created_at", table_name="content_reports"
    )
    op.drop_index("ix_content_reports_created_at", table_name="content_reports")
    op.drop_index("ix_content_reports_target_author_id", table_name="content_reports")
    op.drop_index("ix_content_reports_reporter_id", table_name="content_reports")
    op.drop_index("ix_content_reports_post_id", table_name="content_reports")
    op.drop_table("content_reports")
