import type { OrderReceipt } from "./trading-validation";

export type OrderResultState = {
  kind: "success" | "pending" | "error" | "uncertain";
  message: string;
  id?: string;
};

export function describeOrderReceipt(
  receipt: OrderReceipt,
  name: string,
  formatPrice: (price: number, currency: OrderReceipt["currency"]) => string,
): OrderResultState {
  const { id, status } = receipt;
  switch (status) {
    case "FILLED":
      return { id, kind: "success", message: `${name} 모의주문이 ${formatPrice(receipt.fillPrice, receipt.currency)}에 체결됐어요.` };
    case "OPEN":
      return { id, kind: "pending", message: `${name} 모의주문을 접수했어요. 아직 체결되지 않았어요.` };
    case "TRIGGERED":
      return { id, kind: "pending", message: `${name} · 조건 충족 · 체결 대기. 입력한 지정가 조건에서 체결을 기다려요.` };
    case "REJECTED":
      return { id, kind: "error", message: receipt.detail || "주문이 거절됐어요. 매매 기록에서 사유를 확인해 주세요." };
    case "CANCELLED":
    case "CANCELED":
      return { id, kind: "success", message: "모의주문이 취소됐어요." };
  }
}
