"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/providers/ToastProvider";
import { updateNotificationPreferencesAction } from "@/actions/account";
import type { NotificationPreferences } from "@/services/account";

export interface NotificationPreferencesFormProps {
  initialValues: NotificationPreferences;
}

/** Channel toggles, in the order the NotificationType enum declares them. */
const CHANNELS: {
  key: keyof NotificationPreferences;
  label: string;
  description: string;
}[] = [
  { key: "email", label: "Email", description: "Sent to your account's email address." },
  { key: "sms", label: "SMS", description: "Text messages to your registered phone." },
  { key: "push", label: "Push", description: "Alerts on devices you have signed in on." },
  { key: "inApp", label: "In-app", description: "Shown inside eduOS while you are signed in." },
];

const CATEGORIES: {
  key: keyof NotificationPreferences;
  label: string;
  description: string;
}[] = [
  {
    key: "attendanceAlerts",
    label: "Attendance alerts",
    description: "When attendance falls below the required threshold.",
  },
  {
    key: "feeReminders",
    label: "Fee reminders",
    description: "Before a demand falls due, and when one becomes overdue.",
  },
  {
    key: "resultPublished",
    label: "Results published",
    description: "When examination results are released.",
  },
  {
    key: "announcements",
    label: "Announcements",
    description: "Notices from your university, campus or department.",
  },
];

/**
 * Notification preferences: which events reach you, over which channels.
 *
 * Saved as one batch rather than per-toggle. Firing a request on every flick
 * would put eight writes in the air while somebody makes up their mind, and
 * leave the stored state depending on which one landed last.
 */
export function NotificationPreferencesForm({
  initialValues,
}: NotificationPreferencesFormProps) {
  const { toast } = useToast();

  const [values, setValues] = useState<NotificationPreferences>(initialValues);
  const [saved, setSaved] = useState<NotificationPreferences>(initialValues);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggle(key: keyof NotificationPreferences) {
    setValues((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const isDirty = (Object.keys(values) as (keyof NotificationPreferences)[]).some(
    (key) => values[key] !== saved[key]
  );

  // Every channel off means nothing can ever reach this person. Worth saying
  // out loud rather than silently accepting — it is almost always a mistake,
  // but it is their call, so this warns rather than blocks.
  const allChannelsOff = !values.email && !values.sms && !values.push && !values.inApp;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    const result = await updateNotificationPreferencesAction(values);
    setIsSubmitting(false);

    if (!result.success) {
      setFormError(result.error);
      return;
    }

    // Tracks what the server now holds, so the button disables again without a
    // full page refresh — nothing else on the page depends on these values.
    setSaved(values);
    toast({ variant: "success", title: "Preferences saved" });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      {formError && <Alert variant="error">{formError}</Alert>}

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-2 text-sm font-medium text-foreground">Channels</legend>
        {CHANNELS.map((channel) => (
          <ToggleRow
            key={channel.key}
            label={channel.label}
            description={channel.description}
            checked={Boolean(values[channel.key])}
            onToggle={() => toggle(channel.key)}
          />
        ))}
      </fieldset>

      {allChannelsOff && (
        <Alert variant="warning">
          Every channel is off, so you will not be notified about anything.
        </Alert>
      )}

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-2 text-sm font-medium text-foreground">What to notify me about</legend>
        {CATEGORIES.map((category) => (
          <ToggleRow
            key={category.key}
            label={category.label}
            description={category.description}
            checked={Boolean(values[category.key])}
            onToggle={() => toggle(category.key)}
          />
        ))}
      </fieldset>

      <div className="flex flex-col sm:flex-row sm:justify-end">
        <Button type="submit" isLoading={isSubmitting} disabled={!isDirty} fullWidth className="sm:w-auto">
          Save preferences
        </Button>
      </div>
    </form>
  );
}

/**
 * One labelled toggle.
 *
 * The switch sits after the text on every screen size and the text wraps
 * beneath it, so a long description never squeezes the control off the right
 * edge on a narrow phone.
 */
function ToggleRow({
  label,
  description,
  checked,
  onToggle,
}: {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={checked}
        onChange={onToggle}
        aria-label={label}
        containerClassName="shrink-0 pt-0.5"
      />
    </div>
  );
}
