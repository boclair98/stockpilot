import type { Metadata } from "next";
import StockComparison from "@/components/StockComparison";
export const metadata: Metadata = { title:"종목 비교", description:"한국·미국 종목의 가격 변화와 하락폭을 같은 기간으로 비교해 보세요.", alternates:{canonical:"/compare"} };
export default function ComparePage() { return <StockComparison />; }
