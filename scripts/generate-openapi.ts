import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { apiOpenApiDocument } from "../services/api/src/spec";
import { authOpenApiDocument } from "../services/auth/src/spec";

const root = resolve(import.meta.dir, "..");
const outputs = [
  {
    document: apiOpenApiDocument,
    path: resolve(root, "services/api/openapi.json")
  },
  {
    document: authOpenApiDocument,
    path: resolve(root, "services/auth/openapi.json")
  }
];

for (const output of outputs) {
  await mkdir(dirname(output.path), { recursive: true });
  await writeFile(output.path, `${JSON.stringify(output.document, null, 2)}\n`);
  console.log(`Generated ${output.path.slice(root.length + 1)}`);
}
