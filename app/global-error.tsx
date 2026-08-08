"use client";

/**
 * The last boundary. Catches a failure in the ROOT layout itself.
 *
 * WHY THIS FILE HAS TO EXIST AND WHY IT LOOKS UNLIKE EVERY OTHER ONE
 *   Every route group has an error.tsx, but each of those renders INSIDE the
 *   root layout. If the root layout is what threw, none of them can mount, and
 *   without this file Next.js falls back to its own built-in error page —
 *   unstyled, unbranded, and in development carrying a stack trace.
 *
 *   That is why this component renders its own <html> and <body>: it REPLACES
 *   the root layout rather than nesting in it, so it cannot rely on anything
 *   the layout provides. That includes the design tokens, which live in a
 *   stylesheet the failed layout imports — so the few styles here are inline
 *   and deliberately literal. It is the one file in the project permitted to
 *   carry raw colour values, because a token it cannot load is worse than a
 *   hex it can.
 *
 *   `digest` is shown because it is the only handle a user can quote and an
 *   operator can grep for; the message itself is withheld, since a root-layout
 *   failure is as likely to be a database URL as a typo.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          background: "#f8f9f9",
          color: "#393c3f",
          fontFamily:
            "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <main
          style={{
            maxWidth: "26rem",
            textAlign: "center",
            background: "#ffffff",
            border: "1px solid #e0e2e3",
            borderRadius: "2rem",
            padding: "2rem",
            boxShadow: "0 4px 20px rgba(95, 99, 104, 0.08)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600, color: "#252628" }}>
            Something went wrong
          </h1>
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.875rem", lineHeight: 1.6 }}>
            The application could not start. This is a fault on our side, not
            something you did.
          </p>

          {error.digest && (
            <p
              style={{
                margin: "0.75rem 0 0",
                fontSize: "0.75rem",
                color: "#5f6368",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              Reference: {error.digest}
            </p>
          )}

          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.625rem 1.5rem",
              borderRadius: "9999px",
              border: "none",
              background: "#505458",
              color: "#ffffff",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
