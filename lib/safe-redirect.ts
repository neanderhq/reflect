/** Resolve only same-origin paths; URL parsing also normalizes control characters. */
export function safeRedirect(target: string | null, origin: string): string {
  if (!target?.startsWith('/')) return '/';
  try {
    const url = new URL(target, origin);
    return url.origin === origin ? url.pathname + url.search + url.hash : '/';
  } catch { return '/'; }
}
