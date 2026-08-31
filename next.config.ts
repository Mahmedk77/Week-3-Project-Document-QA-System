import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (and the pdf.js/canvas internals it depends on) must run as a
  // real Node module rather than be bundled by webpack/turbopack, or PDF
  // parsing breaks in the server runtime.
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
};

export default nextConfig;
