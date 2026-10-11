import type { NextConfig } from "next";

const requestedBuildCpus = Number(process.env.STOCKPILOT_BUILD_CPUS);

const nextConfig: NextConfig = {
  // Pre-render every page at build time → produces ./out/ as a tree
  // of HTML, JS, and CSS that nginx serves verbatim. No Node runtime,
  // no headers() at request time, no middleware. All identity + data
  // fetching happens client-side.
  output: "export",
  // SPA-style routing fallback inside `out/` is handled by the nginx
  // config (try_files … /index.html).
  trailingSlash: false,
  ...(Number.isInteger(requestedBuildCpus) && requestedBuildCpus > 0
    ? { experimental: { cpus: requestedBuildCpus } }
    : {}),
};

export default nextConfig;
