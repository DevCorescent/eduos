"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { updateOwnPlatformProfile } from "@/services/platformUsers";

/**
 * Edit the signed-in operator's own name.
 *
 * ONLY THE TWO FIELDS THE BACKEND ACCEPTS
 *   PlatformUser carries firstName, lastName, email, isActive, role and the
 *   password. Everything except the two names is either administrative (role,
 *   activation, email — PATCH /api/platform/users/[id]) or has its own flow
 *   (the password form below this one). Rendering a disabled box for each of
 *   them would suggest a capability this screen does not have, so they are
 *   shown as read-only account information instead and only what actually
 *   persists is editable here.
 *
 * The subject is never sent. The route resolves the operator from the platform
 * session, so this form has no id to submit and no way to name anybody else.
 */
export function ProfileForm({
  initialFirstName,
  initialLastName,
}: {
  initialFirstName: string;
  initialLastName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [values, setValues] = useState({
    firstName: initialFirstName,
    lastName: initialLastName,
  });

  const unchanged =
    values.firstName.trim() === initialFirstName && values.lastName.trim() === initialLastName;

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setSaved(false);

        // Mirrors updateOwnPlatformProfileSchema, so a value this accepts the
        // API takes. Checked here to save a round trip, not instead of the
        // server — the route validates independently.
        if (!values.firstName.trim() || !values.lastName.trim()) {
          setError("Both names are required.");
          return;
        }

        startTransition(async () => {
          const result = await updateOwnPlatformProfile({
            firstName: values.firstName.trim(),
            lastName: values.lastName.trim(),
          });

          if (!result.success) {
            // The button returns — a control left disabled after a failure is
            // indistinguishable from one still working.
            setError(result.error);
            return;
          }

          setSaved(true);
          // The name is rendered by the server component above and in the top
          // bar, so the page is re-read rather than patched locally.
          router.refresh();
        });
      }}
    >
      {error && (
        <Alert variant="error" role="alert">
          {error}
        </Alert>
      )}

      {saved && !error && (
        <Alert variant="success" role="status">
          Your name has been updated.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="First name"
          required
          value={values.firstName}
          onChange={(e) => {
            setSaved(false);
            setValues((v) => ({ ...v, firstName: e.target.value }));
          }}
        />
        <Input
          label="Last name"
          required
          value={values.lastName}
          onChange={(e) => {
            setSaved(false);
            setValues((v) => ({ ...v, lastName: e.target.value }));
          }}
        />
      </div>

      <div>
        {/* Disabled while nothing has changed: submitting an identical body is
            a 400 from the schema's own "at least one key" rule, and offering a
            button whose only outcome is an error is not offering anything. */}
        <Button type="submit" isLoading={pending} disabled={unchanged}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
