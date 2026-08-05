export const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
export const docsUrl = import.meta.env.VITE_DOCS_URL ?? "http://localhost:3003/docs";

export function safeAppUrl(
  requestedPath: string | undefined,
  fallbackPath: string
): string {
  const fallback = new URL(fallbackPath, window.location.origin);
  if (!requestedPath) return fallback.toString();

  try {
    const requested = new URL(requestedPath, window.location.origin);
    return requested.origin === window.location.origin
      ? requested.toString()
      : fallback.toString();
  } catch {
    return fallback.toString();
  }
}
