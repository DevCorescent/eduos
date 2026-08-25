import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The floating dev badge, off.
   *
   * It sits bottom-left over the sidebar, which is exactly where a portal's
   * collapse control and a public site's content live — so every screenshot of
   * this product taken in development has a Next.js logo pasted on it. Compile
   * and runtime errors are still surfaced; only the badge is hidden.
   */
  devIndicators: false,

  turbopack: {
    // Pinned because a stray package-lock.json sits in the parent directory.
    // Turbopack infers the workspace root from the outermost lockfile it finds,
    // which resolves to the parent and makes it warn on every build. Naming the
    // root explicitly settles it without touching anything outside the project.
    root: __dirname,
  },

  /**
   * Routes that moved, answered before anything renders.
   *
   * WHY HERE RATHER THAN A REDIRECTING PAGE
   *   A page calling permanentRedirect() sits inside its portal layout, and
   *   that layout does async work — it reads the session and renders the
   *   notification bell. By the time the page runs, the shell has already been
   *   streamed to the client, so Next cannot answer 308 any more: it emits a
   *   soft redirect inside a 200 instead. It works in a browser, but it costs a
   *   full layout render and a database round trip to move somebody to a page
   *   they are not staying on, and it is not a redirect any crawler or HTTP
   *   client will honour.
   *
   *   Declared here it is a real 308, resolved before routing, at no cost.
   */
  async redirects() {
    return [
      {
        // The notification centre became shared by every role once Phase 27
        // opened /api/notifications beyond UNIVERSITY_ADMIN. The old path was
        // in the student sidebar for the portal's whole life, so it is in
        // bookmarks and history and must keep working.
        source: "/student/notifications",
        destination: "/notifications",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
