import { describe, expect, test } from "bun:test";
import {
  logoGeometry,
  logoPalettes,
  logoVariants
} from "../apps/web/src/lib/logo";

const expectedRadii = [
  logoGeometry.backgroundRadius,
  ...logoGeometry.targetRadii
].map(String);

describe("web logo assets", () => {
  test("defines adaptive and explicit theme variants", () => {
    expect(logoVariants).toEqual(["auto", "light", "dark"]);
    expect(logoPalettes.auto).toEqual({
      background: "fill-[#e4ece5] dark:fill-[#1a261a]",
      target: "stroke-[#1d6d40] dark:stroke-[#6aad75]"
    });
    expect(logoPalettes.light.background).not.toContain("dark:");
    expect(logoPalettes.dark.background).not.toContain("dark:");
  });

  test("keeps the favicon geometry and adaptive palettes aligned", async () => {
    const favicon = await Bun.file(
      new URL("../apps/web/public/favicon.svg", import.meta.url)
    ).text();

    expect(circleRadii(favicon)).toEqual(expectedRadii);
    expect(favicon).toContain("prefers-color-scheme: dark");
    for (const color of ["#e4ece5", "#1d6d40", "#1a261a", "#6aad75"]) {
      expect(favicon).toContain(color);
    }
  });

  test("exports the declared raster fallback sizes", async () => {
    const assets = [
      ["favicon-16x16.png", 16],
      ["favicon-32x32.png", 32],
      ["favicon-48x48.png", 48],
      ["apple-touch-icon.png", 180]
    ] as const;

    for (const [name, size] of assets) {
      const dimensions = await pngDimensions(
        new URL(`../apps/web/public/${name}`, import.meta.url)
      );
      expect(dimensions).toEqual({ width: size, height: size });
    }
  });

  test("declares every exported favicon in the web document", async () => {
    const document = await Bun.file(
      new URL("../apps/web/index.html", import.meta.url)
    ).text();

    for (const asset of [
      "/favicon.svg",
      "/favicon-48x48.png",
      "/favicon-32x32.png",
      "/favicon-16x16.png",
      "/apple-touch-icon.png"
    ]) {
      expect(document).toContain(`href="${asset}"`);
    }
  });
});

function circleRadii(svg: string): string[] {
  return [...svg.matchAll(/<circle\b[^>]*\br="([^"]+)"/g)].map(
    (match) => match[1]!
  );
}

async function pngDimensions(
  path: URL
): Promise<{ width: number; height: number }> {
  const bytes = Buffer.from(await Bun.file(path).arrayBuffer());
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  );
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}
