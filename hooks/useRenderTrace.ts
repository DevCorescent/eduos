"use client";

/* eslint-disable react-hooks/purity, react-hooks/refs -- TEMPORARY DIAGNOSTIC
   INSTRUMENTATION. console.log and Date.now() are impure, and the React
   Compiler is right to refuse them during render. They are here to trace a
   reported "dashboard never loads" and are meant to be removed with the rest of
   the tracing once the cause is settled. Nothing below changes behaviour. */

// ============================================================================
// MODULE : Diagnostics — Client Render Tracing & Loop Detection
// PURPOSE: Count how often a client component renders, and shout when that
//          count becomes implausible.
//
// WHY THE THRESHOLD IS A RATE, NOT A TOTAL
//   A long-lived component legitimately renders many times over a session — a
//   sidebar re-renders on every navigation. What is never legitimate is many
//   renders in a couple of seconds with nothing driving them. So the counter is
//   windowed: it resets when renders stop, and only a burst inside the window
//   trips the alarm.
//
// WHAT A CLEAN RUN LOOKS LIKE
//   In this codebase every dashboard is a Server Component, so the only client
//   components are chrome — the shell, the sidebar, modals. If none of them
//   trips this, a slow dashboard is NOT a render loop, and the [FETCH] waterfall
//   is where the time actually went. Ruling the loop out is the point.
// ============================================================================

import { useEffect, useRef } from "react";

/** Renders within the window above which a burst is reported. */
const LOOP_THRESHOLD = 10;

/** How long a quiet period must be before the counter resets, in ms. */
const WINDOW_MS = 2000;

/**
 * Trace a client component's render cadence.
 *
 * @param component name used in the log prefix
 * @param deps      values worth printing to explain WHY it rendered
 */
export function useRenderTrace(component: string, deps?: Record<string, unknown>) {
  const count = useRef(0);
  const windowStart = useRef(Date.now());
  const reported = useRef(false);

  const now = Date.now();
  if (now - windowStart.current > WINDOW_MS) {
    count.current = 0;
    windowStart.current = now;
    reported.current = false;
  }
  count.current += 1;

  console.log(
    `[HOOK] ${component} render #${count.current}` +
      (deps ? `  deps=${JSON.stringify(deps)}` : "")
  );

  if (count.current > LOOP_THRESHOLD && !reported.current) {
    reported.current = true;
    console.log("**********");
    console.log("POTENTIAL RENDER LOOP");
    console.log(`Component: ${component}`);
    console.log(
      `Reason: ${count.current} renders in ${now - windowStart.current}ms. ` +
        `Deps at trip: ${deps ? JSON.stringify(deps) : "none supplied"}`
    );
    console.log("**********");
  }

  useEffect(() => {
    console.log(`[HOOK] ${component} MOUNTED`);
    return () => console.log(`[HOOK] ${component} UNMOUNTED`);
  }, [component]);
}
