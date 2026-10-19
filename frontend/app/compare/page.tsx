import StockComparison from "@/components/StockComparison";
import { publicPageMetadata } from "@/lib/site-metadata";
export const metadata = publicPageMetadata("/compare", "종목 비교", "한국·미국 종목의 가격 변화와 하락폭을 같은 기간으로 비교해 보세요.");
export default function ComparePage() { return <StockComparison />; }
