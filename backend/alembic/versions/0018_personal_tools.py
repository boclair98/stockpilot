"""Add personal tools, keeping every existing balance and order intact."""
import sqlalchemy as sa
from alembic import op

revision = "0018_personal_tools"
down_revision = "0017_toss_practice_rewards"
branch_labels = None
depends_on = None


def upgrade():
    from app.personal_models import CorporateAction, InboxRead, MoneyEvent, RecurringPlan, RecurringRun, SavedItem, ServiceNotice, SupportTicket
    bind = op.get_bind()
    for model in (SavedItem, InboxRead, SupportTicket, ServiceNotice, RecurringPlan, RecurringRun, MoneyEvent, CorporateAction):
        model.__table__.create(bind, checkfirst=False)
    op.add_column("trade_orders", sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    raise RuntimeError("Personal tools contain user data; destructive downgrade is intentionally disabled")
