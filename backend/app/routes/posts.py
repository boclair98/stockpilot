"""Feed + post endpoints.

GET /api/feed       — public; recent posts across all users.
POST /api/posts     — auth-required; creates a post.
GET /api/users/{id}/posts — public; posts by a specific user.

Mutations require StockPilot's signed Google session.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import desc, delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_session
from app.core.identity import optional_identity, require_identity, require_operator
from app.models import ContentReport, Post, User, UserBlock
from app.routes.users import upsert_local_user

router = APIRouter(prefix="/api", tags=["posts"])


class PostOut(BaseModel):
    id: str
    body: str
    author_id: str
    author_name: str
    created_at: str


def _to_out(p: Post) -> PostOut:
    return PostOut(
        id=str(p.id),
        body=p.body,
        author_id=str(p.author_id),
        author_name=p.author.display_name,
        created_at=p.created_at.isoformat(),
    )


@router.get("/feed", response_model=list[PostOut])
async def feed(
    coders_id: UUID | None = Depends(optional_identity),
    session: AsyncSession = Depends(get_session),
) -> list[PostOut]:
    """Most recent 50 posts, hiding authors blocked by the signed-in user."""
    query = select(Post).options(selectinload(Post.author)).order_by(desc(Post.created_at)).limit(50)
    if coders_id:
        viewer = await session.scalar(select(User).where(User.coders_id == coders_id))
        if viewer:
            blocked = select(UserBlock.blocked_id).where(UserBlock.blocker_id == viewer.id)
            query = query.where(~Post.author_id.in_(blocked))
    res = await session.execute(query)
    return [_to_out(p) for p in res.scalars().all()]


class PostIn(BaseModel):
    body: str = Field(min_length=1, max_length=280)


@router.post("/posts", response_model=PostOut, status_code=201)
async def create_post(
    body: PostIn,
    coders_id: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> PostOut:
    user = await upsert_local_user(session, coders_id)
    clean_body = body.body.strip()
    if not clean_body:
        raise HTTPException(422, "내용을 입력해 주세요.")
    post = Post(author_id=user.id, body=clean_body)
    session.add(post)
    await session.flush()
    # Re-fetch with author loaded for the response.
    res = await session.execute(
        select(Post).options(selectinload(Post.author)).where(Post.id == post.id)
    )
    return _to_out(res.scalar_one())


@router.delete("/posts/{post_id}", status_code=204)
async def delete_post(
    post_id: UUID,
    coders_id: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Delete only a post authored by the signed-in user."""

    user = await upsert_local_user(session, coders_id)
    result = await session.execute(select(Post).where(Post.id == post_id))
    post = result.scalar_one_or_none()
    if post is None:
        raise HTTPException(404, "게시글을 찾을 수 없습니다.")
    if post.author_id != user.id:
        raise HTTPException(403, "내가 작성한 글만 삭제할 수 있습니다.")
    await session.delete(post)
    return Response(status_code=204)


class ReportIn(BaseModel):
    reason: Literal["SPAM", "HARASSMENT", "MISLEADING", "PERSONAL_DATA", "OTHER"]


class ModerationReportOut(BaseModel):
    id: str
    post_id: str
    body: str
    author_name: str
    reason: str
    status: str
    created_at: str


@router.post("/posts/{post_id}/report", status_code=201)
async def report_post(
    post_id: UUID,
    payload: ReportIn,
    coders_id: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    """Report a public post once per signed-in account."""
    reporter = await upsert_local_user(session, coders_id)
    post = await session.scalar(select(Post).where(Post.id == post_id))
    if post is None:
        raise HTTPException(404, "게시글을 찾을 수 없습니다.")
    if post.author_id == reporter.id:
        raise HTTPException(400, "내 글은 신고할 수 없습니다.")
    existing = await session.scalar(
        select(ContentReport).where(
            ContentReport.post_id == post.id,
            ContentReport.reporter_id == reporter.id,
        )
    )
    if existing:
        return {"status": "already_reported"}
    session.add(
        ContentReport(
            post_id=post.id,
            reporter_id=reporter.id,
            target_author_id=post.author_id,
            reason=payload.reason,
        )
    )
    return {"status": "reported"}


@router.post("/users/{user_id}/block", status_code=201)
async def block_user(
    user_id: UUID,
    coders_id: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    """Hide another public user's posts for the signed-in user."""
    blocker = await upsert_local_user(session, coders_id)
    target = await session.scalar(select(User).where(User.id == user_id))
    if target is None:
        raise HTTPException(404, "사용자를 찾을 수 없습니다.")
    if target.id == blocker.id:
        raise HTTPException(400, "내 계정은 차단할 수 없습니다.")
    existing = await session.scalar(
        select(UserBlock).where(
            UserBlock.blocker_id == blocker.id,
            UserBlock.blocked_id == target.id,
        )
    )
    if not existing:
        session.add(UserBlock(blocker_id=blocker.id, blocked_id=target.id))
    return {"status": "blocked"}


@router.delete("/users/{user_id}/block", status_code=204)
async def unblock_user(
    user_id: UUID,
    coders_id: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> Response:
    blocker = await upsert_local_user(session, coders_id)
    await session.execute(
        delete(UserBlock).where(
            UserBlock.blocker_id == blocker.id,
            UserBlock.blocked_id == user_id,
        )
    )
    return Response(status_code=204)


@router.get("/moderation/reports", response_model=list[ModerationReportOut])
async def moderation_reports(
    _: object = Depends(require_operator),
    session: AsyncSession = Depends(get_session),
) -> list[ModerationReportOut]:
    """Operator-only queue for timely UGC moderation."""
    res = await session.execute(
        select(ContentReport, Post, User)
        .join(Post, Post.id == ContentReport.post_id)
        .join(User, User.id == ContentReport.target_author_id)
        .where(ContentReport.status == "PENDING")
        .order_by(ContentReport.created_at)
        .limit(100)
    )
    return [
        ModerationReportOut(
            id=str(report.id),
            post_id=str(post.id),
            body=post.body,
            author_name=author.display_name,
            reason=report.reason,
            status=report.status,
            created_at=report.created_at.isoformat(),
        )
        for report, post, author in res.all()
    ]


class ModerationDecision(BaseModel):
    action: Literal["DISMISS", "REMOVE"]


@router.post("/moderation/reports/{report_id}/resolve")
async def resolve_report(
    report_id: UUID,
    payload: ModerationDecision,
    operator=Depends(require_operator),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    report = await session.scalar(select(ContentReport).where(ContentReport.id == report_id))
    if report is None:
        raise HTTPException(404, "신고를 찾을 수 없습니다.")
    report.status = "ACTIONED" if payload.action == "REMOVE" else "DISMISSED"
    report.resolved_by = operator.id
    report.resolved_at = datetime.now(UTC)
    if payload.action == "REMOVE":
        await session.execute(delete(Post).where(Post.id == report.post_id))
    return {"status": report.status}


@router.get("/users/{user_id}/posts", response_model=list[PostOut])
async def user_posts(
    user_id: UUID, session: AsyncSession = Depends(get_session)
) -> list[PostOut]:
    """Posts by a specific *app-local* user_id (NOT coders_id). Public."""
    exists = await session.execute(select(User).where(User.id == user_id))
    if exists.scalar_one_or_none() is None:
        raise HTTPException(404, "user not found")
    res = await session.execute(
        select(Post)
        .options(selectinload(Post.author))
        .where(Post.author_id == user_id)
        .order_by(desc(Post.created_at))
        .limit(50)
    )
    return [_to_out(p) for p in res.scalars().all()]
