type RuntimeConfig = {
  apiBaseUrl?: string;
  docsUrl?: string;
};

function readRuntimeConfig(): RuntimeConfig {
  if (typeof window === "undefined") return {};
  return (window as Window & { __GOALKEEPER_CONFIG__?: RuntimeConfig })
    .__GOALKEEPER_CONFIG__ ?? {};
}

export function resolveConfiguredUrl(
  runtimeValue: string | undefined,
  buildValue: string | undefined,
  fallback: string
): string {
  return runtimeValue?.trim() || buildValue?.trim() || fallback;
}

const runtimeConfig = readRuntimeConfig();
const browserOrigin =
  typeof window === "undefined" ? "http://localhost" : window.location.origin;

export const apiUrl = resolveConfiguredUrl(
  runtimeConfig.apiBaseUrl,
  import.meta.env.VITE_API_URL,
  browserOrigin
);
export const docsUrl = resolveConfiguredUrl(
  runtimeConfig.docsUrl,
  import.meta.env.VITE_DOCS_URL,
  new URL("/docs", browserOrigin).toString()
);

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
