"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { changePasswordAction } from "@/actions/account";

/** Mirrors changeTenantPasswordSchema and changePasswordAction. */
const MIN_NEW_PASSWORD_LENGTH = 12;

export interface ChangePasswordFormProps {
  /** Where to go once the password is replaced — the caller's own portal home. */
  destination: string;
}

/**
 * Replace the signed-in user's password.
 *
 * Goes through changePasswordAction — the SAME Server Action the /settings
 * password form has always called, which in turn calls services/account.ts.
 * That service is `server-only`, so a client component cannot import it
 * directly; routing through the action is not indirection for its own sake but
 * the only way a browser-side form reaches it, and it keeps both screens on one
 * path rather than this one growing a second.
 *
 * The action re-checks length, reuse and the confirmation server-side. The
 * checks below are for immediate feedback, not for safety: a round trip to
 * learn that two boxes disagree is a worse form.
 */
export function ChangePasswordForm({ destination }: ChangePasswordFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [values, setValues] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setFieldError(null);

        if (values.newPassword.length < MIN_NEW_PASSWORD_LENGTH) {
          setFieldError(`Use at least ${MIN_NEW_PASSWORD_LENGTH} characters.`);
          return;
        }

        if (values.newPassword === values.currentPassword) {
          setFieldError("Choose a password different from the one you were given.");
          return;
        }

        if (values.newPassword !== values.confirmPassword) {
          setFieldError("The two passwords do not match.");
          return;
        }

        startTransition(async () => {
          const result = await changePasswordAction(
            values.currentPassword,
            values.newPassword,
            values.confirmPassword
          );

          if (!result.success) {
            // The action reports which input a failure belongs to. Anything it
            // does not attribute — a wrong current password, a transport
            // failure — is a banner, because it is not about one box.
            if (result.field === "newPassword" || result.field === "confirmPassword") {
              setFieldError(result.error);
            } else {
              setError(result.error);
            }
            // The button comes back — a control left disabled after a failed
            // attempt is indistinguishable from one still working.
            return;
          }

          // refresh() first, so the server re-reads the cleared flag before the
          // portal layout's guard runs against it. Without this the redirect
          // below bounces straight back here.
          router.refresh();
          router.replace(destination);
        });
      }}
    >
      {error && (
        <Alert variant="error" role="alert">
          {error}
        </Alert>
      )}

      <Input
        label="Current password"
        type="password"
        autoComplete="current-password"
        required
        value={values.currentPassword}
        onChange={(e) => setValues((v) => ({ ...v, currentPassword: e.target.value }))}
      />

      <Input
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        value={values.newPassword}
        error={fieldError ?? undefined}
        helperText={`At least ${MIN_NEW_PASSWORD_LENGTH} characters.`}
        onChange={(e) => setValues((v) => ({ ...v, newPassword: e.target.value }))}
      />

      <Input
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        value={values.confirmPassword}
        onChange={(e) => setValues((v) => ({ ...v, confirmPassword: e.target.value }))}
      />

      <Button type="submit" fullWidth disabled={pending}>
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
