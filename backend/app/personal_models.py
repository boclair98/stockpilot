"""Additive personal tools. No real broker accounts or payment credentials."""
import uuid
from datetime import datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SavedItem(Base):
    __tablename__ = "personal_saved_items"
    owner_id: Mapped[uuid.UUID] = mapped_column(sa.UUID, primary_key=True)
    kind: Mapped[str] = mapped_column(sa.String(16), primary_key=True)
    key: Mapped[str] = mapped_column(sa.String(200), primary_key=True)
    data: Mapped[dict] = mapped_column(sa.JSON, nullable=False)
    version: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    deleted: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)
    __table_args__ = (sa.CheckConstraint("version >= 0"),)


class InboxRead(Base):
    __tablename__ = "personal_inbox_reads"
    owner_id: Mapped[uuid.UUID] = mapped_column(sa.UUID, primary_key=True)
    key: Mapped[str] = mapped_column(sa.String(200), primary_key=True)
    read_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


class SupportTicket(Base):
    __tablename__ = "personal_support_tickets"
    id: Mapped[uuid.UUID] = mapped_column(sa.UUID, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(sa.UUID, nullable=False)
    request_key: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    fingerprint: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    category: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    subject: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    body: Mapped[str] = mapped_column(sa.String(2000), nullable=False)
    reply: Mapped[str | None] = mapped_column(sa.String(2000))
    status: Mapped[str] = mapped_column(sa.String(16), nullable=False, default="OPEN")
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)
    __table_args__ = (sa.UniqueConstraint("owner_id", "request_key"), sa.Index("ix_support_owner_created", "owner_id", "created_at"))


class ServiceNotice(Base):
    __tablename__ = "personal_service_notices"
    id: Mapped[uuid.UUID] = mapped_column(sa.UUID, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    body: Mapped[str] = mapped_column(sa.String(2000), nullable=False)
    severity: Mapped[str] = mapped_column(sa.String(12), nullable=False, default="INFO")
    active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


class RecurringPlan(Base):
    __tablename__ = "personal_recurring_plans"
    id: Mapped[uuid.UUID] = mapped_column(sa.UUID, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(sa.UUID, nullable=False)
    request_key: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    fingerprint: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    symbol: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    market: Mapped[str] = mapped_column(sa.String(2), nullable=False)
    exchange: Mapped[str] = mapped_column(sa.String(8), nullable=False)
    name: Mapped[str] = mapped_column(sa.String(100), nullable=False)
    currency: Mapped[str] = mapped_column(sa.String(3), nullable=False)
    amount: Mapped[Decimal] = mapped_column(sa.Numeric(18, 2), nullable=False)
    weekday: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    local_time: Mapped[str] = mapped_column(sa.String(5), nullable=False)
    timezone: Mapped[str] = mapped_column(sa.String(40), nullable=False)
    active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)
    next_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)
    __table_args__ = (sa.UniqueConstraint("owner_id", "request_key"), sa.CheckConstraint("amount > 0"), sa.CheckConstraint("weekday >= 0 AND weekday <= 4"), sa.Index("ix_recurring_owner", "owner_id", "active"))


class RecurringRun(Base):
    __tablename__ = "personal_recurring_runs"
    id: Mapped[uuid.UUID] = mapped_column(sa.UUID, primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("personal_recurring_plans.id"), nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(sa.UUID, nullable=False)
    due_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    reason: Mapped[str] = mapped_column(sa.String(240), nullable=False)
    order_id: Mapped[uuid.UUID | None] = mapped_column(sa.ForeignKey("trade_orders.id"))
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)
    __table_args__ = (sa.UniqueConstraint("plan_id", "due_at"), sa.Index("ix_recurring_runs_owner", "owner_id", "created_at"))


class MoneyEvent(Base):
    __tablename__ = "personal_money_events"
    id: Mapped[uuid.UUID] = mapped_column(sa.UUID, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(sa.UUID, nullable=False)
    kind: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    request_key: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    status: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    data: Mapped[dict] = mapped_column(sa.JSON, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)
    __table_args__ = (sa.UniqueConstraint("owner_id", "kind", "request_key"), sa.Index("ix_money_events_owner_created", "owner_id", "created_at"))


class CorporateAction(Base):
    __tablename__ = "personal_corporate_actions"
    id: Mapped[uuid.UUID] = mapped_column(sa.UUID, primary_key=True, default=uuid.uuid4)
    source_key: Mapped[str] = mapped_column(sa.String(128), nullable=False, unique=True)
    symbol: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    market: Mapped[str] = mapped_column(sa.String(2), nullable=False)
    exchange: Mapped[str] = mapped_column(sa.String(8), nullable=False)
    currency: Mapped[str] = mapped_column(sa.String(3), nullable=False)
    kind: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    status: Mapped[str] = mapped_column(sa.String(16), nullable=False, default="VERIFIED")
    per_share: Mapped[Decimal | None] = mapped_column(sa.Numeric(18, 6))
    ratio: Mapped[Decimal | None] = mapped_column(sa.Numeric(18, 8))
    cutoff_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    pay_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, index=True)
    source_url: Mapped[str] = mapped_column(sa.String(500), nullable=False)
    verified_by: Mapped[uuid.UUID | None] = mapped_column(sa.UUID)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)
    __table_args__ = (sa.CheckConstraint("pay_at >= cutoff_at"), sa.CheckConstraint("kind IN ('DIVIDEND','SPLIT')"))
