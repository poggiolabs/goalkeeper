import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createWebDistributionManifest,
  emptyRuntimeConfig,
  verifyWebDistribution,
  webDistributionManifestName,
  writeSha256Checksum,
  writeWebDistributionManifest
} from "../scripts/web-distribution";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

async function distributionDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "goalkeeper-web-"));
  directories.push(directory);
  await writeFile(
    path.join(directory, "index.html"),
    '<script src="/runtime-config.js"></script><div id="root"></div>\n'
  );
  await writeFile(path.join(directory, "runtime-config.js"), emptyRuntimeConfig);
  return directory;
}

describe("web distribution", () => {
  test("records and verifies immutable release coordinates", async () => {
    const directory = await distributionDirectory();
    const revision = "a".repeat(40);
    const expected = createWebDistributionManifest("0.1.0", revision);

    await expect(
      writeWebDistributionManifest(directory, "0.1.0", revision)
    ).resolves.toEqual(expected);
    await expect(
      verifyWebDistribution(directory, "0.1.0", revision)
    ).resolves.toBeUndefined();

    await writeFile(
      path.join(directory, webDistributionManifestName),
      `${JSON.stringify({ ...expected, revision: "b".repeat(40) })}\n`
    );
    await expect(
      verifyWebDistribution(directory, "0.1.0", revision)
    ).rejects.toThrow("manifest does not match");
  });

  test("writes a filename-bound SHA-256 checksum", async () => {
    const directory = await distributionDirectory();
    const archive = path.join(directory, "goalkeeper-web-dist-0.1.0.tar.gz");
    await writeFile(archive, "release bytes");

    const checksum = await writeSha256Checksum(archive);
    expect(await Bun.file(checksum).text()).toMatch(
      /^[0-9a-f]{64}  goalkeeper-web-dist-0\.1\.0\.tar\.gz\n$/
    );
  });
});
