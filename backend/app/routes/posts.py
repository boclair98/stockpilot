"""Feed + post endpoints.

GET /api/feed       — public; recent posts across all users.
POST /api/posts     — auth-required; creates a post.
GET /api/users/{id}/posts — public; posts by a specific user.

Mutations require StockPilot's signed Google session.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_session
from app.core.identity import require_identity
from app.models import Post, User
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
async def feed(session: AsyncSession = Depends(get_session)) -> list[PostOut]:
    """Most recent 50 posts, newest first. Public — no identity needed."""
    res = await session.execute(
        select(Post)
        .options(selectinload(Post.author))
        .order_by(desc(Post.created_at))
        .limit(50)
    )
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
    post = Post(author_id=user.id, body=body.body.strip())
    session.add(post)
    await session.flush()
    # Re-fetch with author loaded for the response.
    res = await session.execute(
        select(Post).options(selectinload(Post.author)).where(Post.id == post.id)
    )
    return _to_out(res.scalar_one())


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
