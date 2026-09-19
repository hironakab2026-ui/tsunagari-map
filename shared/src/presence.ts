/** この時間以内にアプリを開いていた人は「オンライン」 */
export const ONLINE_WINDOW_MS = 5 * 60_000;

export function isOnline(lastSeenAt: string | undefined, now = Date.now()): boolean {
  if (!lastSeenAt) return false;
  const t = new Date(lastSeenAt).getTime();
  return Number.isFinite(t) && now - t >= 0 && now - t <= ONLINE_WINDOW_MS;
}