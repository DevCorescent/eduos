import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pinned because a stray package-lock.json sits in the parent directory.
    // Turbopack infers the workspace root from the outermost lockfile it finds,
    // which resolves to the parent and makes it warn on every build. Naming the
    // root explicitly settles it without touching anything outside the project.
    root: __dirname,
  },
};

export default nextConfig;
