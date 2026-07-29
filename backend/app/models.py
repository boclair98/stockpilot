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
    symbol: Mapped[str] = mapped_column(sa.String(12), nullable=False)
    exchange: Mapped[str] = mapped_column(
        sa.String(8), nullable=False, default="KRX", server_default="KRX"
    )
    side: Mapped[str] = mapped_column(sa.String(4), nullable=False)
    order_type: Mapped[str] = mapped_column(sa.String(8), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(sa.Numeric(18, 6), nullable=False)
    limit_price: Mapped[Decimal | None] = mapped_column(sa.Numeric(18, 4))
    fill_price: Mapped[Decimal | None] = mapped_column(sa.Numeric(18, 4))
    status: Mapped[str] = mapped_column(sa.String(12), nullable=False, default="OPEN")
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), index=True
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
