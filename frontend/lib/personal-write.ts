/** Request-key preparation is pure; a blocked edit must not replace an uncertain key. */
export type PersonalRequestKey = { key: string; fingerprint: string };

export function writeAttempt(url: string, body: unknown, method = "POST") {
  return JSON.stringify({ url, body, method });
}

export function prepareKeyedWrite(
  previous: PersonalRequestKey | null,
  pendingAttempt: string | null,
  url: string,
  body: Record<string, unknown>,
  freshKey = false,
  createKey = () => crypto.randomUUID() as string,
) {
  const fingerprint = JSON.stringify({ url, body });
  // Expiration may request a new quote, but cannot replace an unresolved one.
  const request = (!freshKey || pendingAttempt) && previous?.fingerprint === fingerprint
    ? previous
    : { key: createKey(), fingerprint };
  const payload = { ...body, requestKey: request.key };
  if (pendingAttempt && pendingAttempt !== writeAttempt(url, payload)) return null;
  return { request, payload };
}

export function personalTime(at: string) {
  const date = new Date(at);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : "—";
}
