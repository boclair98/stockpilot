"use client";

/**
 * Browser-side API helpers. All calls hit /api/* on this same origin;
 * the nginx in front of us proxies that to the backend KSvc.
 *
 * Every fetch is wrapped in `tracked()` so the global WarmingBar can
 * react when any of them spends more than ~5s in flight (lib/warming).
 */

import { tracked } from "./warming";
import { requestJson } from "./reliable-request";

export type Post = {
  id: string;
  body: string;
  author_id: string;
  author_name: string;
  created_at: string;
};

function checkedPosts(value: unknown): Post[] {
  if (!Array.isArray(value) || !value.every(row => row && [row.id, row.body, row.author_id, row.author_name, row.created_at].every(field => typeof field === "string") && Number.isFinite(Date.parse(row.created_at)))) {
    throw new Error("게시글 응답을 확인하지 못했어요. 다시 조회해 주세요.");
  }
  return value;
}

export async function fetchFeed(signal?: AbortSignal): Promise<Post[]> {
  return tracked(async () => {
    return checkedPosts(await requestJson<unknown>("/api/feed", { credentials: "include", signal, cache: "no-store" }));
  });
}

export async function fetchUserPosts(userId: string, signal?: AbortSignal): Promise<Post[]> {
  return tracked(async () => {
    return checkedPosts(await requestJson<unknown>(`/api/users/${encodeURIComponent(userId)}/posts`, { credentials: "include", signal, cache: "no-store" }));
  });
}

export async function createPost(body: string): Promise<Post> {
  return tracked(async () => {
    const r = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ body }),
    });
    if (!r.ok) {
      let detail = `Post failed (${r.status})`;
      try {
        const j = await r.json();
        if (j?.detail) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      } catch {
        /* non-JSON */
      }
      throw new Error(detail);
    }
    return r.json();
  });
}

export async function deletePost(postId: string): Promise<void> {
  return tracked(async () => {
    const r = await fetch(`/api/posts/${postId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!r.ok) {
      let detail = `삭제하지 못했어요 (${r.status})`;
      try {
        const j = await r.json();
        if (j?.detail) detail = String(j.detail);
      } catch {
        /* non-JSON */
      }
      throw new Error(detail);
    }
  });
}

export async function reportPost(
  postId: string,
  reason: "SPAM" | "HARASSMENT" | "MISLEADING" | "PERSONAL_DATA" | "OTHER",
): Promise<void> {
  return tracked(async () => {
    const r = await fetch(`/api/posts/${postId}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ reason }),
    });
    if (!r.ok) {
      let detail = `신고하지 못했어요 (${r.status})`;
      try {
        const j = await r.json();
        if (j?.detail) detail = String(j.detail);
      } catch {
        /* non-JSON */
      }
      throw new Error(detail);
    }
  });
}

export async function blockUser(userId: string): Promise<void> {
  return tracked(async () => {
    const r = await fetch(`/api/users/${userId}/block`, {
      method: "POST",
      credentials: "include",
    });
    if (!r.ok) {
      let detail = `차단하지 못했어요 (${r.status})`;
      try {
        const j = await r.json();
        if (j?.detail) detail = String(j.detail);
      } catch {
        /* non-JSON */
      }
      throw new Error(detail);
    }
  });
}

export async function deleteMyAccount(): Promise<void> {
  return tracked(async () => {
    const r = await fetch("/api/me", {
      method: "DELETE",
      credentials: "include",
    });
    if (!r.ok) {
      let detail = `계정을 삭제하지 못했어요 (${r.status})`;
      try {
        const j = await r.json();
        if (j?.detail) detail = String(j.detail);
      } catch {
        /* non-JSON */
      }
      throw new Error(detail);
    }
  });
}
