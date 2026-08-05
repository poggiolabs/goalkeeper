import { createMDX } from "fumadocs-mdx/next";

const config = {
  agentRules: false,
  reactStrictMode: true
};

export default createMDX()(config);
