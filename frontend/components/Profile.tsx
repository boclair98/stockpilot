"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { deleteMyAccount, fetchUserPosts, type Post } from "@/lib/api";
import { useMe } from "@/lib/identity";
import { SignInLink } from "./SignIn";

export function Profile() {
  const me = useMe();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    if (!me) return;
    fetchUserPosts(me.id).then(setPosts);
  }, [me]);

  async function removeAccount() {
    if (deleting) return;
    const confirmed = window.confirm(
      "계정을 삭제하면 가상잔고, 주문, 관심종목, 투자일지, 리그 기록과 게시글이 모두 삭제됩니다. 계속할까요?",
    );
    if (!confirmed) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteMyAccount();
      window.location.href = "/?account_deleted=1";
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "계정을 삭제하지 못했어요.");
      setDeleting(false);
    }
  }

  if (me === undefined) {
    return (
      <div className="space-y-3 pt-4">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (me === null) {
    return (
      <div className="space-y-4 pt-4">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          Profile
        </h1>
        <p className="text-[15px] text-muted-foreground">
          You need to sign in to see this page.
        </p>
        <SignInLink returnTo="/profile" />
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <header className="pt-4">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          {me.display_name}
        </h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Your app-local profile, mirrored from the coders.kr platform
          identity on first sight.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Identity
        </h2>
        <dl className="divide-y rounded-md border text-[14px]">
          <Row label="display name">{me.display_name}</Row>
          <Row label="coders.kr id" mono>{me.coders_id}</Row>
          <Row label="first seen">
            {new Date(me.first_seen_at).toLocaleString()}
          </Row>
        </dl>
      </section>

      <section className="space-y-4">
        <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Your posts
        </h2>
        <ul className="space-y-1">
          {posts === null && (
            <li>
              <Skeleton className="h-16 w-full" />
            </li>
          )}
          {posts && posts.length === 0 && (
            <li className="rounded-md border border-dashed bg-muted/40 px-5 py-6 text-center text-[13px] text-muted-foreground">
              None yet — head to{" "}
              <Link
                href="/"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                the feed
              </Link>{" "}
              and write one.
            </li>
          )}
          {posts?.map((p) => (
            <li
              key={p.id}
              className="-mx-3 rounded-md px-3 py-3 transition-colors hover:bg-muted/50"
            >
              <time className="text-[12px] text-muted-foreground" dateTime={p.created_at}>
                {new Date(p.created_at).toLocaleString()}
              </time>
              <div className="mt-1.5 text-[15px] leading-relaxed whitespace-pre-wrap">
                {p.body}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Privacy controls
        </h2>
        <div className="rounded-md border bg-muted/20 px-4 py-4">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            StockPilot에 저장된 내 프로필·가상거래·학습 기록을 JSON으로 내려받을 수 있어요. 푸시 기기 토큰은 보안을 위해 파일에 포함하지 않습니다.
          </p>
          <a
            href="/api/me/export"
            className="mt-3 inline-flex items-center rounded-md border bg-background px-3 py-2 text-[13px] font-medium hover:bg-muted"
          >
            내 데이터 다운로드
          </a>
        </div>
      </section>

      <section className="space-y-4 border-t pt-8">
        <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          계정 삭제
        </h2>
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-4">
          <p className="text-[13px] leading-relaxed text-red-900/75">
            StockPilot 계정과 연결된 가상거래·학습·라운지 데이터를 영구적으로 삭제합니다. 삭제 후에는 복구할 수 없습니다.
          </p>
          {deleteError && <p className="mt-3 text-[13px] text-red-700" role="alert">{deleteError}</p>}
          <button
            type="button"
            disabled={deleting}
            onClick={() => void removeAccount()}
            className="mt-3 inline-flex min-h-11 items-center rounded-md border border-red-300 bg-white px-3 py-2 text-[13px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            {deleting ? "삭제 중…" : "내 계정과 데이터 삭제"}
          </button>
        </div>
      </section>
    </div>
  );
}

function Row({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-4 px-4 py-3">
      <dt className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd className={mono ? "font-mono text-[12px]" : ""}>{children}</dd>
    </div>
  );
}
