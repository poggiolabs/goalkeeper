import { docs } from "collections";
import { loader } from "fumadocs-core/source";

const mdxSource = docs.toFumadocsSource();
const files = mdxSource.files as unknown;
const resolvedSource = {
  ...mdxSource,
  files: typeof files === "function" ? files() : files
} as typeof mdxSource;

export const source = loader(resolvedSource, {
  baseUrl: "/docs"
});
