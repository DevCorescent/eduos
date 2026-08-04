"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { forgotPassword } from "@/services/auth";

interface ForgotPasswordForm {
  tenantSlug: string;
  email: string;
}

type FieldErrors = Partial<Record<keyof ForgotPasswordForm, string>>;

function validate(form: ForgotPasswordForm): FieldErrors {
  const errors: FieldErrors = {};

  if (!form.tenantSlug.trim()) {
    errors.tenantSlug = "Enter your institution code.";
  }
  if (!form.email.trim()) {
    errors.email = "Enter your email address.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  return errors;
}

/**
 * Step one of the reset flow: ask for a code.
 *
 * On success it does not navigate. It swaps to a confirmation panel that links
 * forward to /reset-password carrying `tenant` and `email` in the query string,
 * because a one-time code is only checkable against the account that requested
 * it — and User is unique on (tenantId, email), so the address alone does not
 * identify anyone.
 *
 * Query params rather than sessionStorage: the reset link a user follows from
 * their inbox will carry the same two values, so the next screen must accept
 * them from the URL anyway. Storing them would add a second path that only
 * works in the tab the request started in.
 */
export function ForgotPasswordForm() {
  const [form, setForm] = useState<ForgotPasswordForm>({ tenantSlug: "", email: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);

  function updateField<K extends keyof ForgotPasswordForm>(field: K, value: ForgotPasswordForm[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
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

    const result = await forgotPassword({
      tenantSlug: form.tenantSlug.trim(),
      email: form.email.trim(),
    });

    setIsSubmitting(false);

    if (!result.success) {
      setFormError(result.error);
      return;
    }

    setIsSent(true);
  }

  if (isSent) {
    const nextHref = `/reset-password?tenant=${encodeURIComponent(form.tenantSlug.trim())}&email=${encodeURIComponent(form.email.trim())}`;

    return (
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 text-center shadow-sm">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success-bg text-success-bg-foreground">
          <CheckCircle2 className="size-6" aria-hidden="true" />
        </div>

        <h1 className="mt-4 text-xl font-semibold text-heading">Check your email</h1>

        {/* Worded so it holds whether or not the address is registered. The
            endpoint does not disclose which, so this copy must not either. */}
        <p className="mt-2 text-sm text-muted-foreground">
          If <span className="font-medium text-foreground">{form.email.trim()}</span> has an
          account, a verification code is on its way. Enter it on the next screen.
        </p>

        {/* A real anchor, not a button with an onClick — this navigates, so it
            should support middle-click and "open in new tab" like any link. */}
        <Link href={nextHref} className={buttonStyles({ size: "lg", fullWidth: true, className: "mt-6" })}>
          Enter code
        </Link>

        <Link
          href="/login"
          className="mt-4 block text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-heading">Reset your password</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter your institution code and email — we&apos;ll send you a verification code.
      </p>

      {formError && (
        <Alert variant="error" className="mt-5">
          {formError}
        </Alert>
      )}

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

        <Button type="submit" variant="primary" size="lg" fullWidth isLoading={isSubmitting}>
          Send code
        </Button>

        <Link
          href="/login"
          className="text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          Back to sign in
        </Link>
      </form>
    </div>
  );
}
