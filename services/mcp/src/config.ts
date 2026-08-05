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
