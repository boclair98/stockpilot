"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { createPost, fetchFeed, type Post } from "@/lib/api";
import { useMe } from "@/lib/identity";
import { SignInLink } from "./SignIn";

const MAX_BODY = 280;

export function Feed() {
  const me = useMe();
  const [feed, setFeed] = useState<Post[] | null>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [bodyLen, setBodyLen] = useState(0);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchFeed().then(setFeed);
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = (form.elements.namedItem("body") as HTMLTextAreaElement).value
      .trim();
    if (!body || posting) return;
    setPostError(null);
    setPosting(true);
    try {
      const created = await createPost(body);
      form.reset();
      setBodyLen(0);
      setFeed((existing) => (existing ? [created, ...existing] : [created]));
      textRef.current?.focus();
    } catch (err) {
      setPostError((err as Error).message);
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="space-y-12">
      <header className="pt-4">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          Feed
        </h1>
        <p className="mt-2 max-w-xl text-[15px] text-muted-foreground leading-relaxed">
          Anyone can read. Signed-in visitors can post. StockPilot uses{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">
            Google OAuth
          </code>{" "}
          for login.
        </p>
      </header>

      {me === undefined ? null : me ? (
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="rounded-md border focus-within:border-foreground/50 transition-colors">
            <textarea
              id="body"
              name="body"
              ref={textRef}
              required
              maxLength={MAX_BODY}
              rows={3}
              placeholder={`Say something, ${me.display_name}.`}
              onChange={(e) => setBodyLen(e.target.value.length)}
              className="block w-full resize-none rounded-md bg-transparent px-3.5 py-3 text-[15px] leading-relaxed placeholder:text-muted-foreground focus:outline-none"
            />
            <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
              <div className="flex items-center gap-3 text-[12px]">
                <span
                  className={cn(
                    "tabular-nums text-muted-foreground",
                    bodyLen >= MAX_BODY * 0.9 && "text-amber-600 dark:text-amber-400",
                    bodyLen >= MAX_BODY && "text-destructive"
                  )}
                >
                  {bodyLen} / {MAX_BODY}
                </span>
                {postError && (
                  <span className="text-destructive">{postError}</span>
                )}
              </div>
              <Button type="submit" size="sm" disabled={posting || bodyLen === 0}>
                {posting ? "Posting…" : "Post"}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed px-4 py-3">
          <p className="text-[14px] text-muted-foreground">
            Sign in to post.
          </p>
          <SignInLink size="sm" />
        </div>
      )}

      <section className="space-y-4">
        <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Recent
        </h2>
        <ul className="space-y-1">
          {feed === null && <FeedLoading />}
          {feed && feed.length === 0 && (
            <li className="rounded-md border border-dashed bg-muted/40 px-5 py-8 text-center">
              <MessageSquare className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">No posts yet</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Be the first.
              </p>
            </li>
          )}
          {feed?.map((p) => <PostRow key={p.id} post={p} />)}
        </ul>
      </section>
    </div>
  );
}

function FeedLoading() {
  // Warming hint moved to the top-level WarmingBar in layout.tsx so
  // it covers every page consistently. Here we just stack skeletons.
  return (
    <>
      <li>
        <Skeleton className="h-16 w-full" />
      </li>
      <li>
        <Skeleton className="h-16 w-full" />
      </li>
    </>
  );
}

function PostRow({ post }: { post: Post }) {
  return (
    <li className="group -mx-3 rounded-md px-3 py-3 transition-colors hover:bg-muted/50">
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Avatar name={post.author_name} />
        <span className="font-medium text-foreground">{post.author_name}</span>
        <span aria-hidden>·</span>
        <time dateTime={post.created_at}>
          {new Date(post.created_at).toLocaleString()}
        </time>
      </div>
      <div className="mt-1.5 text-[15px] leading-relaxed whitespace-pre-wrap">
        {post.body}
      </div>
    </li>
  );
}

function Avatar({ name }: { name: string }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <span
      aria-hidden
      className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground"
    >
      {initial}
    </span>
  );
}
