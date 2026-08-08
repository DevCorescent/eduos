"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { resetPassword } from "@/services/auth";
import { useToast } from "@/providers/ToastProvider";

interface ResetPasswordForm {
  otp: string;
  newPassword: string;
  confirmPassword: string;
}

type FieldErrors = Partial<Record<keyof ResetPasswordForm, string>>;

/** Mirrors what a password field should enforce before a round trip is spent. */
const MIN_PASSWORD_LENGTH = 8;

function validate(form: ResetPasswordForm): FieldErrors {
  const errors: FieldErrors = {};

  if (!form.otp.trim()) {
    errors.otp = "Enter the verification code.";
  } else if (!/^\d{6}$/.test(form.otp.trim())) {
    errors.otp = "The code is 6 digits.";
  }

  if (!form.newPassword) {
    errors.newPassword = "Choose a new password.";
  } else if (form.newPassword.length < MIN_PASSWORD_LENGTH) {
    errors.newPassword = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  // Checked only once a password exists, so an empty form reports the missing
  // password rather than a mismatch between two blanks.
  if (form.newPassword && form.newPassword !== form.confirmPassword) {
    errors.confirmPassword = "Passwords do not match.";
  }

  return errors;
}

/**
 * Step two of the password reset.
 *
 * `tenant` and `email` arrive in the query string — set by step one, and by the
 * link in the reset email. Both are needed because a code is only checkable
 * against the account that requested it, and User is unique on
 * (tenantId, email), so an address alone is ambiguous across tenants.
 *
 * Landing here without them is a real case (a bookmarked URL, a truncated
 * link), so the form is not shown at all in that state — submitting a code that
 * cannot be attributed to an account would fail server-side with a message that
 * explains nothing.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const tenantSlug = searchParams.get("tenant") ?? "";
  const email = searchParams.get("email") ?? "";

  const [form, setForm] = useState<ResetPasswordForm>({
    otp: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField<K extends keyof ResetPasswordForm>(field: K, value: ResetPasswordForm[K]) {
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

    const result = await resetPassword({
      tenantSlug,
      email,
      otp: form.otp.trim(),
      newPassword: form.newPassword,
    });

    if (!result.success) {
      setFormError(result.error);
      setIsSubmitting(false);
      return;
    }

    // A toast rather than a success panel: the user is being sent to the login
    // page, so an inline confirmation would unmount before it was read.
    toast({
      variant: "success",
      title: "Password updated",
      description: "Sign in with your new password.",
    });

    router.replace(`/login?tenant=${encodeURIComponent(tenantSlug)}`);
  }

  if (!tenantSlug || !email) {
    return (
      <div className="glass w-full rounded-xl p-8">
        <h1 className="text-xl font-semibold text-heading">Link incomplete</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This reset link is missing the account it belongs to. Request a new code to start
          again.
        </p>

        <Alert variant="info" className="mt-5">
          Open the most recent link from your email, or request a fresh code.
        </Alert>

        <div className="mt-6 flex flex-col gap-3">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => router.push("/forgot-password")}
          >
            Request a new code
          </Button>

          <Link
            href="/login"
            className="text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="glass w-full rounded-xl p-8">
      <h1 className="text-xl font-semibold text-heading">Enter verification code</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Resetting the password for{" "}
        <span className="font-medium text-foreground">{email}</span>.
      </p>

      {formError && (
        <Alert variant="error" className="mt-5">
          {formError}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <Input
          label="Verification Code"
          required
          value={form.otp}
          onChange={(e) => updateField("otp", e.target.value)}
          error={fieldErrors.otp}
          placeholder="6-digit code"
          // inputMode surfaces the numeric keypad on mobile; autoComplete lets
          // the browser and iOS offer the code straight from the SMS or email.
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
        />

        <Input
          label="New Password"
          type="password"
          required
          value={form.newPassword}
          onChange={(e) => updateField("newPassword", e.target.value)}
          error={fieldErrors.newPassword}
          helperText={`Use at least ${MIN_PASSWORD_LENGTH} characters.`}
          autoComplete="new-password"
        />

        <Input
          label="Confirm Password"
          type="password"
          required
          value={form.confirmPassword}
          onChange={(e) => updateField("confirmPassword", e.target.value)}
          error={fieldErrors.confirmPassword}
          autoComplete="new-password"
        />

        <Button type="submit" variant="primary" size="lg" fullWidth isLoading={isSubmitting}>
          Reset password
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
