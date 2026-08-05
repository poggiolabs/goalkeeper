import { describe, expect, test } from "bun:test";
import { resolveConfiguredUrl } from "../apps/web/src/lib/config";
import { emptyRuntimeConfig } from "../scripts/web-distribution";

describe("web runtime configuration", () => {
  test("prefers runtime values, then build values, then deployment defaults", () => {
    expect(
      resolveConfiguredUrl(
        "https://runtime.example.com",
        "https://build.example.com",
        "https://fallback.example.com"
      )
    ).toBe("https://runtime.example.com");
    expect(
      resolveConfiguredUrl(
        " ",
        "https://build.example.com",
        "https://fallback.example.com"
      )
    ).toBe("https://build.example.com");
    expect(resolveConfiguredUrl(undefined, undefined, "/v1")).toBe("/v1");
  });

  test("supplies local service URLs through the Vite development environment", async () => {
    expect(await Bun.file(".env.development").text()).toBe(
      "VITE_API_URL=http://localhost:3001\n" +
        "VITE_DOCS_URL=http://localhost:3003/docs\n"
    );
  });

  test("keeps the checked-in placeholder aligned with release packaging", async () => {
    expect(await Bun.file("apps/web/public/runtime-config.js").text()).toBe(
      emptyRuntimeConfig
    );
    expect(await Bun.file("apps/web/index.html").text()).toContain(
      'src="/runtime-config.js"'
    );
  });
});
