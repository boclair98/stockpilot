import StockDirectoryRedirect from "@/components/StockDirectoryRedirect";
import { publicPageMetadata } from "@/lib/site-metadata";

export const metadata = publicPageMetadata("/stocks", "국내·미국 전체 종목", "한국 코스피·코스닥과 미국 나스닥·뉴욕·아멕스 종목을 회사명과 종목코드로 찾아보세요.");
export default function StocksPage() { return <StockDirectoryRedirect />; }
