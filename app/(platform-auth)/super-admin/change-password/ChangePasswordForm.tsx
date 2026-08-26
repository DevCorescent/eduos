"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { changeOwnPlatformPassword } from "@/services/platformUsers";

/** Mirrors changePlatformPasswordSchema, so a value this accepts the API takes. */
const MIN_NEW_PASSWORD_LENGTH = 12;

export interface ChangePasswordFormProps {
  /**
   * What happens once the password is changed.
   *
   * "redirect" — the default, and the behaviour the FORCED flow depends on:
   *   an operator sent here by the platform layout is returned to the console
   *   the moment their generated password is replaced.
   *
   * "stay" — for the Settings screen, where the form is one section among
   *   several and the operator chose to be here. Confirms in place instead.
   *
   * Defaulted rather than required so the forced-change page keeps working
   * unchanged and cannot acquire the new behaviour by accident.
   */
  onSuccess?: "redirect" | "stay";
}

/**
 * Replace the signed-in operator's password.
 *
 * Goes through the service layer rather than calling fetch() directly — unlike
 * PlatformLoginForm, which must read a Set-Cookie response. This route sets no
 * cookie: the session is already valid and carries no claim the change affects.
 *
 * The confirmation field is checked HERE and never sent. The API has no notion
 * of a confirmation — it is a typing check on a value nobody can read back, and
 * it belongs beside the two boxes rather than in a schema.
 */
export function ChangePasswordForm({ onSuccess = "redirect" }: ChangePasswordFormProps = {}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
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
          const result = await changeOwnPlatformPassword({
            currentPassword: values.currentPassword,
            newPassword: values.newPassword,
          });

          if (!result.success) {
            // The button comes back — a control left disabled after a failed
            // attempt is indistinguishable from one still working.
            setError(result.error);
            return;
          }

          // refresh() first, so the server re-reads the cleared flag before the
          // platform layout's guard runs against it. Without this the redirect
          // below bounces straight back to this page.
          router.refresh();

          // FORCED arrival: the operator came here because the console refused
          // them, so completing the change is the moment to send them into it.
          // VOLUNTARY arrival from Settings: they are already where they meant
          // to be, and moving them would lose the rest of the page. The session
          // is untouched either way — this route sets no cookie and the change
          // invalidates no claim the platform token carries.
          if (onSuccess === "redirect") {
            router.replace("/platform/dashboard");
            return;
          }

          setChanged(true);
          setValues({ currentPassword: "", newPassword: "", confirmPassword: "" });
        });
      }}
    >
      {error && (
        <Alert variant="error" role="alert">
          {error}
        </Alert>
      )}

      {changed && !error && (
        <Alert variant="success" role="status">
          Your password has been changed. You are still signed in.
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
