type PackageManifest = {
  scripts?: Record<string, string>;
};

const manifest = (await Bun.file(
  new URL("../package.json", import.meta.url)
).json()) as PackageManifest;

console.log("Available targets:");
for (const target of Object.keys(manifest.scripts ?? {})) {
  console.log(`  bun run ${target}`);
}
