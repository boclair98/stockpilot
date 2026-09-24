import type { Quote } from "./types";

export function quoteTime(stock: Quote): { label: string; stale: boolean } {
  if (!stock.asOf) return { label: "시세 기준시각 확인 불가", stale: true };
  const timestamp = Date.parse(stock.asOf);
  if (!Number.isFinite(timestamp)) return { label: "시세 기준시각 확인 불가", stale: true };
  const ageMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  const zone = stock.market === "KR" ? "Asia/Seoul" : "America/New_York";
  const suffix = stock.market === "KR" ? "KST" : "ET";
  const clock = new Intl.DateTimeFormat("ko-KR", { timeZone: zone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(timestamp);
  return { label: `${clock} ${suffix} 기준${ageMinutes >= 2 ? ` · ${ageMinutes}분 전` : ""}`, stale: ageMinutes >= 2 };
}

export function sessionLabel(stock: Quote): string {
  const zone = stock.market === "KR" ? "Asia/Seoul" : "America/New_York";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  if (["Sat", "Sun"].includes(part("weekday"))) return "주말 · 장 시간 외";
  const minutes = Number(part("hour")) * 60 + Number(part("minute"));
  if (stock.market === "US") return minutes >= 570 && minutes < 960 ? "미국 정규 거래시간대" : "미국 정규장 시간 외";
  if (minutes >= 540 && minutes < 930) return "KRX 정규 거래시간대";
  if (stock.exchange === "NXT" && ((minutes >= 480 && minutes < 530) || (minutes >= 940 && minutes < 1200))) return "NXT 거래시간대";
  return "국내 정규장 시간 외";
}
