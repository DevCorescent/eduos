/* eslint-disable react-hooks/purity, react-hooks/refs -- TEMPORARY DIAGNOSTIC
   INSTRUMENTATION. console.log and Date.now() are impure, and the React
   Compiler is right to refuse them during render. They are here to trace a
   reported "dashboard never loads" and are meant to be removed with the rest of
   the tracing once the cause is settled. Nothing below changes behaviour. */
// ============================================================================
// MODULE : Diagnostics — Server Render Tracing
// PURPOSE: One helper so every server-rendered page and layout logs its own
//          start and finish the same way, with a duration.
//
// WHY A HELPER RATHER THAN console.log AT EACH SITE
//   The point of these logs is to be READ TOGETHER — a page's total against the
//   sum of the [FETCH] hops inside it. That comparison only works if every line
//   has the same shape, and hand-written logs drift immediately.
//
// SERVER COMPONENTS DO NOT RE-RENDER
//   There is deliberately no "re-render" or "unmount" counterpart here. A page
//   under app/ is a Server Component: it runs once per request, produces markup,
//   and is gone. If a page appears twice in one page load, that is two REQUESTS
//   — a redirect, a refresh, or an RSC navigation — not a re-render, and the
//   distinction is what stops a slow page being misdiagnosed as a render loop.
// ============================================================================

/** Marks the start of a server render and returns the finisher. */
export function traceRender(scope: string, detail?: Record<string, unknown>) {
  const start = Date.now();
  console.log(
    `[${scope}] RENDER START` + (detail ? `  ${JSON.stringify(detail)}` : "")
  );

  return function done(outcome: string = "rendered") {
    console.log(`[${scope}] RENDER END    outcome=${outcome}  total=${Date.now() - start}ms`);
  };
}
