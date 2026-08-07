"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/providers/ToastProvider";
import { changePasswordAction } from "@/actions/account";

interface PasswordValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const EMPTY: PasswordValues = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

type FieldErrors = Partial<Record<keyof PasswordValues, string>>;

/**
 * Change password.
 *
 * The current password is asked for even though the user is already signed in:
 * a session left open on a shared machine must not be enough to lock its owner
 * out of their own account.
 *
 * On success the fields are cleared rather than left filled. A password manager
 * offering to save a value that is no longer current is worse than no offer.
 */
export function PasswordForm() {
  const { toast } = useToast();

  const [values, setValues] = useState<PasswordValues>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function setValue<K extends keyof PasswordValues>(key: K, value: PasswordValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    // Checked here as well as in the action so the mismatch is caught without a
    // round trip — the user cannot read either field back to compare them.
    if (values.newPassword !== values.confirmPassword) {
      setFieldErrors({ confirmPassword: "The two passwords do not match." });
      return;
    }

    setIsSubmitting(true);
    const result = await changePasswordAction(
      values.currentPassword,
      values.newPassword,
      values.confirmPassword
    );
    setIsSubmitting(false);

    if (!result.success) {
      if (result.field) {
        setFieldErrors({ [result.field]: result.error } as FieldErrors);
        return;
      }
      setFormError(result.error);
      return;
    }

    setValues(EMPTY);
    toast({
      variant: "success",
      title: "Password changed",
      description: "Use the new password the next time you sign in.",
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {formError && <Alert variant="error">{formError}</Alert>}

      <Input
        label="Current password"
        type="password"
        required
        value={values.currentPassword}
        onChange={(e) => setValue("currentPassword", e.target.value)}
        error={fieldErrors.currentPassword}
        autoComplete="current-password"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="New password"
          type="password"
          required
          value={values.newPassword}
          onChange={(e) => setValue("newPassword", e.target.value)}
          error={fieldErrors.newPassword}
          helperText="At least 8 characters."
          autoComplete="new-password"
        />
        <Input
          label="Confirm new password"
          type="password"
          required
          value={values.confirmPassword}
          onChange={(e) => setValue("confirmPassword", e.target.value)}
          error={fieldErrors.confirmPassword}
          autoComplete="new-password"
        />
      </div>

      <div className="flex flex-col sm:flex-row sm:justify-end">
        <Button type="submit" isLoading={isSubmitting} fullWidth className="sm:w-auto">
          Change password
        </Button>
      </div>
    </form>
  );
}
