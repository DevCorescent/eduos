"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { login } from "@/services/auth";
import { homeRouteForRoles } from "@/constants/roles";

interface LoginForm {
  tenantSlug: string;
  email: string;
  password: string;
}

type FieldErrors = Partial<Record<keyof LoginForm, string>>;

/**
 * Client-side validation, run before the request.
 *
 * Not a substitute for the server's Zod schema — it exists to save a round trip
 * and to attach the message to the field it concerns, which a single top-level
 * "Invalid input" from the API cannot do.
 */
function validate(form: LoginForm): FieldErrors {
  const errors: FieldErrors = {};

  if (!form.tenantSlug.trim()) {
    errors.tenantSlug = "Enter your institution code.";
  }
  if (!form.email.trim()) {
    errors.email = "Enter your email address.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = "Enter a valid email address.";
  }
  if (!form.password) {
    errors.password = "Enter your password.";
  }

  return errors;
}

/**
 * The sign-in form.
 *
 * Split out from page.tsx because useSearchParams() suspends: reading it in a
 * client component forces every ancestor up to the nearest Suspense boundary to
 * be client-rendered, and with no boundary at all the build fails outright. The
 * page keeps a server-rendered shell and wraps this in Suspense, so the card and
 * the layout still stream immediately.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [form, setForm] = useState<LoginForm>({
    // Pre-filled from ?tenant= so a university can hand out a link that only
    // asks its own people for credentials.
    tenantSlug: searchParams.get("tenant") ?? "",
    email: "",
    password: "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField<K extends keyof LoginForm>(field: K, value: LoginForm[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Clear the field's error as soon as it is edited. Leaving it up while the
    // user fixes the problem reads as though the fix was rejected.
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const errors = validate(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);

    const result = await login({
      tenantSlug: form.tenantSlug.trim(),
      email: form.email.trim(),
      password: form.password,
    });

    if (!result.success) {
      setFormError(result.error);
      setIsSubmitting(false);
      return;
    }

    // Roles, plural. The API returns `data.user.roles: string[]` — an earlier
    // version of this page read a singular `role`, which is always undefined,
    // so every user silently fell through to /dashboard and no admin ever
    // reached the platform console.
    // W1.4 — an account whose password was issued by somebody else goes
    // straight to the form that replaces it, ahead of ?next and ahead of the
    // role-based home. Every other destination would render a console in which
    // requireAuth refuses every request, which reads as the product being
    // broken rather than as an action being required.
    //
    // This is navigation, not enforcement: the gate is requireAuth, which
    // re-reads the column on every request.
    const destination = result.data.user.mustChangePassword
      ? "/change-password"
      : (searchParams.get("next") ?? homeRouteForRoles(result.data.user.roles));

    // replace(), not push(): the login page must not be reachable with the back
    // button once signed in. refresh() re-runs the Server Components so the
    // portal layout picks up the new session cookie.
    //
    // isSubmitting is deliberately left true — navigation is in flight, and
    // re-enabling the button here would invite a second submit.
    router.replace(destination);
    router.refresh();
  }

  return (
    <div className="glass w-full rounded-xl p-8">
      <h1 className="text-xl font-semibold text-heading">Sign in to eduOS</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter your institution code and credentials to continue.
      </p>

      {formError && (
        <Alert variant="error" className="mt-5">
          {formError}
        </Alert>
      )}

      {/* noValidate hands validation to `validate()` above, so the messages are
          ours and styled — the browser's native bubbles are neither. */}
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <Input
          label="Institution Code"
          required
          value={form.tenantSlug}
          onChange={(e) => updateField("tenantSlug", e.target.value)}
          error={fieldErrors.tenantSlug}
          placeholder="your-university"
          autoComplete="organization"
          autoFocus
        />

        <Input
          label="Email"
          type="email"
          required
          value={form.email}
          onChange={(e) => updateField("email", e.target.value)}
          error={fieldErrors.email}
          placeholder="you@university.edu"
          autoComplete="username"
        />

        <Input
          label="Password"
          type="password"
          required
          value={form.password}
          onChange={(e) => updateField("password", e.target.value)}
          error={fieldErrors.password}
          autoComplete="current-password"
        />

        <Button type="submit" variant="primary" size="lg" fullWidth isLoading={isSubmitting}>
          Sign in
        </Button>

        <Link
          href="/forgot-password"
          className="text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          Forgot your password?
        </Link>
      </form>
    </div>
  );
}
