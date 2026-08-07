const defaultMcpPort = 3002;

export function parseMcpPort(value: string | undefined): number {
  if (value === undefined) return defaultMcpPort;
  if (!/^\d+$/.test(value)) {
    throw new Error("MCP_PORT must be an integer between 1 and 65535");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("MCP_PORT must be an integer between 1 and 65535");
  }
  return port;
}

const oauthScopeToken = /^[\x21\x23-\x5b\x5d-\x7e]+$/;

export function parseMcpScopeList(
  value: string | undefined,
  name: string
): string[] | undefined {
  if (value === undefined) return undefined;
  const entries = [...new Set(value.split(",").map((entry) => entry.trim()))];
  if (
    entries.length === 0 ||
    entries.some((entry) => !oauthScopeToken.test(entry))
  ) {
    throw new Error(
      `${name} must be a comma-separated list of RFC 6749 scope-token values`
    );
  }
  return entries;
}
