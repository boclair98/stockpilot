"use client";

import { useEffect } from "react";
import { ALL_INSTRUMENTS_HREF } from "@/lib/market-browse";
import { embeddedDirectoryHref, parseDirectoryCriteria } from "@/lib/stock-directory";

/** Keep old bookmarks working; the directory now lives inside the market. */
export default function StockDirectoryRedirect() {
  useEffect(() => {
    location.replace(embeddedDirectoryHref(parseDirectoryCriteria(location.search)));
  }, []);
  return <main className="stock-directory directory-redirect">
    <h1>시장에서 전체 종목을 찾아보세요</h1>
    <p role="status">검색 조건을 유지한 채 시장 화면으로 이동하고 있어요.</p>
    <a href={ALL_INSTRUMENTS_HREF}>전체 종목 열기</a>
  </main>;
}
