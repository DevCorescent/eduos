"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";

/**
 * The platform sign-in form.
 *
 * Calls the API directly rather than through a Server Action, because the
 * response must SET A COOKIE the browser then carries — the platform session
 * is established by the route handler's Set-Cookie, and the form's only job is
 * to send credentials and navigate on success.
 *
 * ONE ERROR MESSAGE FOR EVERY FAILURE
 *   The API answers identically for an unknown address, a wrong password, a
 *   deactivated identity and an account holding no platform role. The form
 *   shows what the API said and infers nothing further — anything more specific
 *   would confirm which addresses are platform operators.
 */
export function PlatformLoginForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState({ email: "", password: "" });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);

        startTransition(async () => {
          try {
            const response = await fetch("/api/super-admin/auth/login", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(values),
            });

            const payload = await response.json();

            if (!payload.success) {
              // The button comes back — a control left disabled after a failed
              // attempt is indistinguishable from one still working.
              setError(payload.error ?? "Could not sign in.");
              return;
            }

            // refresh() first, so the server re-reads the new cookie before the
            // dashboard's layout guard runs against it.
            router.refresh();
            router.replace("/platform/dashboard");
          } catch {
            setError("Could not reach the server. Check your connection and try again.");
          }
        });
      }}
    >
      {error && (
        <Alert variant="error" role="alert">
          {error}
        </Alert>
      )}

      <Input
        label="Email"
        type="email"
        autoComplete="username"
        required
        value={values.email}
        onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
      />

      <Input
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={values.password}
        onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
      />

      <Button type="submit" fullWidth disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
