import uuid
from datetime import date, datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class User(Base):
    """App-local user keyed by a stable UUID derived from Google ``sub``."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Legacy column name retained to avoid a destructive production migration.
    coders_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), unique=True, nullable=False, index=True
    )
    # Editable inside the app. Default to a short slice of coders_id so
    # something shows up before the user picks a name.
    display_name: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    first_seen_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()
    )

    posts: Mapped[list["Post"]] = relationship(
        back_populates="author", cascade="all, delete-orphan"
    )


class Post(Base):
    """A short message authored by a logged-in user."""

    __tablename__ = "posts"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    body: Mapped[str] = mapped_column(sa.String(280), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), index=True
    )

    author: Mapped[User] = relationship(back_populates="posts")


class TradingAccount(Base):
    __tablename__ = "trading_accounts"
    owner_id: Mapped[uuid.UUID] = mapped_column(sa.UUID(as_uuid=True), primary_key=True)
    cash: Mapped[Decimal] = mapped_column(
        sa.Numeric(18, 2), nullable=False, default=100000
    )
    cash_krw: Mapped[Decimal] = mapped_column(
        sa.Numeric(18, 0), nullable=False, default=100_000_000
    )


class Position(Base):
    __tablename__ = "positions"
    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), nullable=False, index=True
    )
    symbol: Mapped[str] = mapped_column(sa.String(12), nullable=False)
    exchange: Mapped[str] = mapped_column(
        sa.String(8), nullable=False, default="KRX", server_default="KRX"
    )
    quantity: Mapped[Decimal] = mapped_column(
        sa.Numeric(18, 6), nullable=False, default=0
    )
    average_price: Mapped[Decimal] = mapped_column(
        sa.Numeric(18, 4), nullable=False, default=0
    )
    __table_args__ = (sa.UniqueConstraint("owner_id", "symbol", "exchange"),)


class TradeOrder(Base):
    __tablename__ = "trade_orders"
    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), nullable=False, index=True
    )
    idempotency_key: Mapped[str | None] = mapped_column(sa.String(128), nullable=True)
    request_fingerprint: Mapped[str | None] = mapped_column(
        sa.String(64), nullable=True
    )
    symbol: Mapped[str] = mapped_column(sa.String(12), nullable=False)
    exchange: Mapped[str] = mapped_column(
        sa.String(8), nullable=False, default="KRX", server_default="KRX"
    )
    side: Mapped[str] = mapped_column(sa.String(4), nullable=False)
    order_type: Mapped[str] = mapped_column(sa.String(12), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(sa.Numeric(18, 6), nullable=False)
    limit_price: Mapped[Decimal | None] = mapped_column(sa.Numeric(18, 4))
    trigger_price: Mapped[Decimal | None] = mapped_column(sa.Numeric(18, 4))
    fill_price: Mapped[Decimal | None] = mapped_column(sa.Numeric(18, 4))
    fee: Mapped[Decimal] = mapped_column(
        sa.Numeric(18, 4), nullable=False, default=0, server_default="0"
    )
    tax: Mapped[Decimal] = mapped_column(
        sa.Numeric(18, 4), nullable=False, default=0, server_default="0"
    )
    realized_pnl: Mapped[Decimal | None] = mapped_column(sa.Numeric(18, 4))
    risk_code: Mapped[str | None] = mapped_column(sa.String(32))
    reject_reason: Mapped[str | None] = mapped_column(sa.String(200))
    status: Mapped[str] = mapped_column(sa.String(12), nullable=False, default="OPEN")
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), index=True
    )
    __table_args__ = (
        sa.UniqueConstraint(
            "owner_id", "idempotency_key", name="uq_trade_orders_owner_idempotency"
        ),
    )


class AuditEvent(Base):
    """Append-only evidence for security and trading investigations.

    The application exposes no update/delete path for this table. Production
    retention and export controls are documented in BROKERAGE_READINESS.md.
    """

    __tablename__ = "audit_events"
    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(sa.String(48), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), nullable=False, index=True
    )
    request_id: Mapped[str] = mapped_column(sa.String(64), nullable=False, index=True)
    details: Mapped[dict] = mapped_column(sa.JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        server_default=sa.func.now(),
        nullable=False,
        index=True,
    )


class TradingControl(Base):
    """Single-row operational kill switch and pre-trade risk limits."""

    __tablename__ = "trading_controls"
    scope: Mapped[str] = mapped_column(sa.String(16), primary_key=True)
    halted: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=False, server_default=sa.false()
    )
    halt_reason: Mapped[str | None] = mapped_column(sa.String(200))
    max_order_notional_krw: Mapped[Decimal] = mapped_column(
        sa.Numeric(18, 0), nullable=False, default=100_000_000
    )
    max_order_notional_usd: Mapped[Decimal] = mapped_column(
        sa.Numeric(18, 2), nullable=False, default=100_000
    )
    max_open_orders: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=20)
    max_daily_orders: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, default=200
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(sa.UUID(as_uuid=True))
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        server_default=sa.func.now(),
        onupdate=sa.func.now(),
        nullable=False,
    )


class ReconciliationRun(Base):
    """Immutable summary of one ledger consistency check."""

    __tablename__ = "reconciliation_runs"
    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    status: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    account_count: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    order_count: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    position_count: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    discrepancy_count: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    cash_krw_total: Mapped[Decimal] = mapped_column(sa.Numeric(24, 0), nullable=False)
    cash_usd_total: Mapped[Decimal] = mapped_column(sa.Numeric(24, 2), nullable=False)
    details: Mapped[dict] = mapped_column(sa.JSON, nullable=False, default=dict)
    initiated_by: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        server_default=sa.func.now(),
        nullable=False,
        index=True,
    )


class LeagueParticipant(Base):
    """Public league profile linked only to an internal trading-account id."""

    __tablename__ = "league_participants"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), unique=True, nullable=False, index=True
    )
    nickname: Mapped[str] = mapped_column(
        sa.String(24), unique=True, nullable=False, index=True
    )
    joined_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )
    active: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=True, server_default=sa.true()
    )


class LeagueRankSnapshot(Base):
    """One daily rank per participant, used only to show rank movement."""

    __tablename__ = "league_rank_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    participant_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("league_participants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    snapshot_date: Mapped[date] = mapped_column(sa.Date, nullable=False, index=True)
    rank: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    return_rate: Mapped[Decimal] = mapped_column(sa.Numeric(12, 6), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )

    __table_args__ = (
        sa.UniqueConstraint(
            "participant_id",
            "snapshot_date",
            name="uq_league_snapshot_participant_date",
        ),
    )


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), nullable=False, index=True
    )
    symbol: Mapped[str] = mapped_column(sa.String(12), nullable=False)
    exchange: Mapped[str] = mapped_column(sa.String(8), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )

    __table_args__ = (
        sa.UniqueConstraint(
            "owner_id",
            "symbol",
            "exchange",
            name="uq_watchlist_owner_symbol_exchange",
        ),
    )


class PriceAlert(Base):
    __tablename__ = "price_alerts"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), nullable=False, index=True
    )
    symbol: Mapped[str] = mapped_column(sa.String(12), nullable=False)
    exchange: Mapped[str] = mapped_column(sa.String(8), nullable=False)
    direction: Mapped[str] = mapped_column(sa.String(5), nullable=False)
    target_price: Mapped[Decimal] = mapped_column(sa.Numeric(18, 4), nullable=False)
    status: Mapped[str] = mapped_column(
        sa.String(12), nullable=False, default="ACTIVE", server_default="ACTIVE"
    )
    triggered_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    notified_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    read_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


class PushDevice(Base):
    __tablename__ = "push_devices"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), nullable=False, index=True
    )
    token: Mapped[str] = mapped_column(sa.Text, unique=True, nullable=False)
    user_agent: Mapped[str | None] = mapped_column(sa.String(255))
    enabled: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=True, server_default=sa.true()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


class PortfolioDailySnapshot(Base):
    __tablename__ = "portfolio_daily_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), nullable=False, index=True
    )
    snapshot_date: Mapped[date] = mapped_column(sa.Date, nullable=False, index=True)
    equity_krw: Mapped[Decimal] = mapped_column(sa.Numeric(18, 2), nullable=False)
    equity_usd: Mapped[Decimal] = mapped_column(sa.Numeric(18, 4), nullable=False)
    return_rate: Mapped[Decimal] = mapped_column(sa.Numeric(12, 6), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )

    __table_args__ = (
        sa.UniqueConstraint(
            "owner_id",
            "snapshot_date",
            name="uq_portfolio_snapshot_owner_date",
        ),
    )


class LeagueRoom(Base):
    __tablename__ = "league_rooms"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    invite_code: Mapped[str] = mapped_column(
        sa.String(10), unique=True, nullable=False, index=True
    )
    mode: Mapped[str] = mapped_column(
        sa.String(12), nullable=False, default="SEASON", server_default="SEASON"
    )
    max_members: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, default=100, server_default="100"
    )
    starts_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False
    )
    ends_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


class LeagueRoomMember(Base):
    __tablename__ = "league_room_members"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    league_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("league_rooms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), nullable=False, index=True
    )
    nickname: Mapped[str] = mapped_column(sa.String(24), nullable=False)
    baseline_krw: Mapped[Decimal] = mapped_column(sa.Numeric(18, 2), nullable=False)
    baseline_usd: Mapped[Decimal] = mapped_column(sa.Numeric(18, 4), nullable=False)
    joined_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )

    __table_args__ = (
        sa.UniqueConstraint(
            "league_id",
            "owner_id",
            name="uq_league_room_member_owner",
        ),
        sa.UniqueConstraint(
            "league_id",
            "nickname",
            name="uq_league_room_member_nickname",
        ),
    )


class DailyChallengeAttempt(Base):
    """One answer per user and calendar day for the five-minute challenge."""

    __tablename__ = "daily_challenge_attempts"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), nullable=False, index=True
    )
    challenge_date: Mapped[date] = mapped_column(sa.Date, nullable=False, index=True)
    symbol: Mapped[str] = mapped_column(sa.String(12), nullable=False)
    exchange: Mapped[str] = mapped_column(sa.String(8), nullable=False)
    choice: Mapped[str] = mapped_column(sa.String(5), nullable=False)
    start_price: Mapped[Decimal] = mapped_column(sa.Numeric(18, 4), nullable=False)
    end_price: Mapped[Decimal] = mapped_column(sa.Numeric(18, 4), nullable=False)
    score: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )

    __table_args__ = (
        sa.UniqueConstraint(
            "owner_id",
            "challenge_date",
            name="uq_daily_challenge_owner_date",
        ),
    )


class TradeJournal(Base):
    """Private pre-trade thesis and post-trade review."""

    __tablename__ = "trade_journals"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), nullable=False, index=True
    )
    symbol: Mapped[str] = mapped_column(sa.String(12), nullable=False)
    exchange: Mapped[str] = mapped_column(sa.String(8), nullable=False)
    thesis: Mapped[str] = mapped_column(sa.String(500), nullable=False)
    horizon: Mapped[str] = mapped_column(sa.String(12), nullable=False)
    target_return: Mapped[Decimal | None] = mapped_column(sa.Numeric(8, 3))
    stop_loss: Mapped[Decimal | None] = mapped_column(sa.Numeric(8, 3))
    confidence: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    review: Mapped[str | None] = mapped_column(sa.String(500))
    outcome: Mapped[str | None] = mapped_column(sa.String(12))
    reviewed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )
