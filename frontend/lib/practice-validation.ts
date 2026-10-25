/** Historical practice has whole-share orders; never silently coerce an empty,
 * negative or fractional draft into a one-share purchase. */
export function practiceQuantity(draft: string): number | null {
  if (!/^\d+$/.test(draft.trim())) return null;
  const value = Number(draft);
  return Number.isSafeInteger(value) && value >= 1 && value <= 10_000 ? value : null;
}
