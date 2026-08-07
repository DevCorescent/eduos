import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BadgeCheck, Bell, KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getCurrentUser, getNotificationPreferences } from "@/services/account";
import { getPortalSession } from "@/services/session";
import { roleLabel } from "@/constants/roles";
import { formatDate } from "@/utils/format";
import { ProfileForm } from "./ProfileForm";
import { PasswordForm } from "./PasswordForm";
import { NotificationPreferencesForm } from "./NotificationPreferencesForm";

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings — the signed-in person's own account.
 *
 * Sections are stacked cards rather than tabs. Tabs hide two thirds of a short
 * page behind a click and collapse badly on a phone, where the bar either
 * scrolls sideways or wraps into two rows; four headings down the page cost
 * nothing and are searchable with the browser's own find.
 */
export default async function SettingsPage() {
  const [session, user, preferencesResult] = await Promise.all([
    getPortalSession(),
    getCurrentUser(),
    getNotificationPreferences(),
  ]);

  // The layout above has already redirected an anonymous visitor; this is the
  // narrow case of a session that resolves to no user record.
  if (!session) redirect("/login");

  const header = (
    <PageHeader
      title="Settings"
      subtitle="Your profile, password and notification preferences."
    />
  );

  if (!user) {
    return (
      <>
        {header}
        <ErrorState
          title="Couldn't load your account"
          description="Your session is valid but no user record was found behind it. Sign out and back in, and tell an administrator if it happens again."
        />
      </>
    );
  }

  return (
    <>
      {header}

      {/* max-w keeps the form lines readable on a wide monitor — a text input
          stretched to 1400px is harder to use, not easier. */}
      <div className="flex max-w-3xl flex-col gap-6">
        <Card
          header={
            <SectionHeading
              icon={<UserRound className="size-4" />}
              title="Profile"
              description="How your name appears across eduOS, and how we reach you."
            />
          }
        >
          <ProfileForm
            initialValues={{
              firstName: user.firstName,
              lastName: user.lastName,
              email: user.email,
              phone: user.phone ?? "",
            }}
          />
        </Card>

        <Card
          header={
            <SectionHeading
              icon={<KeyRound className="size-4" />}
              title="Password"
              description="Change the password you sign in with."
            />
          }
        >
          <PasswordForm />
        </Card>

        <Card
          header={
            <SectionHeading
              icon={<Bell className="size-4" />}
              title="Notifications"
              description="Choose what reaches you, and how."
            />
          }
        >
          {preferencesResult.success ? (
            <NotificationPreferencesForm initialValues={preferencesResult.data} />
          ) : (
            <ErrorState
              title="Couldn't load your preferences"
              description={preferencesResult.error}
              className="border-0 bg-transparent"
            />
          )}
        </Card>

        <Card
          header={
            <SectionHeading
              icon={<ShieldCheck className="size-4" />}
              title="Account & privacy"
              description="What this account is, and what it can reach."
            />
          }
        >
          <dl className="flex flex-col">
            <Field
              label="Account status"
              value={
                <StatusBadge
                  label={user.isActive ? "Active" : "Deactivated"}
                  variant={user.isActive ? "success" : "danger"}
                />
              }
            />
            <Field
              label="Email verified"
              value={
                user.isVerified ? (
                  <span className="inline-flex items-center gap-1.5 text-sm text-success">
                    <BadgeCheck className="size-4" aria-hidden="true" />
                    Verified
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Not verified — ask an administrator to resend the invitation.
                  </span>
                )
              }
            />
            <Field
              label="Roles"
              value={
                session.roles.length === 0 ? (
                  "—"
                ) : (
                  // Wraps rather than scrolls: on a narrow screen a user with
                  // five roles would otherwise push the card sideways.
                  <div className="flex flex-wrap gap-1.5">
                    {session.roles.map((role) => (
                      <Badge key={role} size="sm">
                        {roleLabel(role)}
                      </Badge>
                    ))}
                  </div>
                )
              }
            />
            <Field
              label="Last signed in"
              value={user.lastLoginAt ? formatDate(user.lastLoginAt) : "—"}
            />
            <Field label="Member since" value={formatDate(user.createdAt)} />
          </dl>

          <p className="mt-4 text-xs text-muted-foreground">
            Roles are granted by an administrator and cannot be changed here. Your academic
            records — attendance, results and fees — are held by your university, which is
            the controller of that data; contact them for a copy or a correction.
          </p>
        </Card>
      </div>
    </>
  );
}

/** Icon + title + description, shared by all four card headers. */
function SectionHeading({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-bg text-primary"
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-heading">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

/** One label/value row in the account card. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 last:border-0 sm:flex-row sm:items-center sm:gap-4">
      <dt className="shrink-0 text-xs text-muted-foreground sm:w-40">{label}</dt>
      <dd className="min-w-0 text-sm text-foreground">{value}</dd>
    </div>
  );
}
