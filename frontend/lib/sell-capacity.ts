const SHARE_SCALE = 1_000_000;
export const MAX_ORDER_SHARES = 10_000;

const shareFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 6 });
export const formatShares = (quantity: number) => `${shareFormat.format(quantity)}주`;
export const UNKNOWN_SELL_CAPACITY = "매도 가능 수량을 확인하지 못했어요.";

type SellCapacity = {
  heldQuantity: number;
  pendingOrderQuantity: number;
  protectionQuantity: number;
  availableQuantity: number;
};

function shareUnits(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const units = Math.round(value * SHARE_SCALE);
  return Number.isSafeInteger(units) && units / SHARE_SCALE === value ? units : null;
}

export function confirmedSellCapacity(
  position: { quantity: number; sellCapacity?: unknown } | undefined,
  coverageComplete: unknown,
): SellCapacity | null {
  if (!position) {
    return coverageComplete === true
      ? { heldQuantity: 0, pendingOrderQuantity: 0, protectionQuantity: 0, availableQuantity: 0 }
      : null;
  }
  const raw = position.sellCapacity;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const held = shareUnits(position.quantity);
  const pending = shareUnits(data.pendingOrderQuantity);
  const protection = shareUnits(data.protectionQuantity);
  const available = shareUnits(data.availableQuantity);
  if (held === null || pending === null || protection === null || available === null) return null;
  if (available !== Math.max(0, held - pending - protection)) return null;
  return {
    heldQuantity: held / SHARE_SCALE,
    pendingOrderQuantity: pending / SHARE_SCALE,
    protectionQuantity: protection / SHARE_SCALE,
    availableQuantity: available / SHARE_SCALE,
  };
}
