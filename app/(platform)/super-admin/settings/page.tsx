import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, LogOut, Palette, ShieldCheck, UserRound } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StateView } from "@/components/shared/StateView";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { resolveFailureState } from "@/lib/ui-state";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { buttonStyles } from "@/components/ui/Button";
import { getOwnPlatformSettings } from "@/services/platformUsers";
import { formatDate } from "@/utils/format";
import { ChangePasswordForm } from "@/app/(platform-auth)/super-admin/change-password/ChangePasswordForm";
import { resolveAccent } from "@/lib/constants/platformAccent";
import { AppearanceForm } from "./AppearanceForm";
import { ProfileForm } from "./ProfileForm";
import { SignOutButton } from "./SignOutButton";

export const metadata: Metadata = { title: "Settings" };

/**
 * Super Admin Settings — the platform operator's own account.
 *
 * WHY THIS LIVES IN THE (platform) GROUP DESPITE ITS /super-admin/… URL
 *   Route groups do not appear in the URL, so a page here answers at
 *   /super-admin/settings while inheriting app/(platform)/layout.tsx — which
 *   runs requirePlatformAdmin() and renders the console chrome. That gives this
 *   screen the console's sidebar and top bar, and it gives it the console's
 *   guard, in one move.
 *
 *   The two pages under (platform-auth) — login and change-password — stay
 *   where they are precisely because they must be reachable WITHOUT that guard:
 *   one is where a session is obtained, and the other serves operators the
 *   guard refuses while mustChangePassword is set. This page is neither.
 *
 * WHAT IS ON IT, AND WHY NOTHING ELSE IS
 *   Every section below is backed by a column that exists on PlatformUser and
 *   an endpoint that already persists it. There is no theme control, no
 *   notification toggle, no timezone or language selector and no two-factor
 *   switch, because the schema carries no column for any of them and a control
 *   that does not persist is a lie told in a nicer font. What the model does
 *   carry and this screen cannot change — email, role, activation — is shown as
 *   read-only account information rather than as a disabled input suggesting an
 *   edit that is merely unavailable today.
 *
 * A Server Component: the account is read during render, so the first paint
 * already carries it and there is no spinner-then-identity flash. The identity
 * comes from the platform session server-side; nothing here trusts the browser.
 */
export default async function PlatformSettingsPage() {
  const result = await getOwnPlatformSettings();

  const header = (
    <PageHeader
      title="Settings"
      subtitle="Your platform operator account."
      action={
        <Link href="/platform/dashboard" className={buttonStyles({ variant: "secondary" })}>
          Back to console
        </Link>
      }
    />
  );

  // A failure is rendered as one. The layout's guard has already turned away
  // anonymous and non-platform callers, so reaching this branch means the
  // request itself failed — and reporting that as an empty account would be the
  // same defect this project has fixed twice already.
  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(result)}
          subject="your account"
          message={result.error}
        />
      </>
    );
  }

  const operator = result.data;

  return (
    <>
      {header}

      <div className="flex flex-col gap-6">
        <Card
          header={
            <div className="flex items-center gap-2">
              <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium text-heading">Account</span>
            </div>
          }
        >
          <dl className="mb-6 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Email</dt>
              {/* Read-only: the address identifies the account and is the
                  subject of the platform session. Changing it is an
                  administrative act with a uniqueness check behind it and stays
                  on PATCH /api/platform/users/[id]. */}
              <dd className="mt-0.5 text-sm text-foreground">{operator.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Platform role</dt>
              <dd className="mt-0.5 flex flex-wrap gap-1.5">
                {operator.roles.length > 0 ? (
                  operator.roles.map((role) => (
                    <Badge key={role} variant="info" size="sm">
                      {role}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Account status</dt>
              <dd className="mt-0.5">
                <StatusBadge
                  label={operator.isActive ? "Active" : "Inactive"}
                  variant={operator.isActive ? "success" : "neutral"}
                  size="sm"
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Operator since</dt>
              <dd className="mt-0.5 text-sm text-foreground">{formatDate(operator.createdAt)}</dd>
            </div>
          </dl>

          <ProfileForm
            initialFirstName={operator.firstName}
            initialLastName={operator.lastName}
          />
        </Card>

        <Card
          header={
            <div className="flex items-center gap-2">
              <Palette className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium text-heading">Appearance</span>
            </div>
          }
        >
          {/* The accent is stored on this operator's own row and applied by the
              platform layout to the console subtree alone. resolveAccent turns
              null, or a value this release no longer knows, into DEFAULT. */}
          <AppearanceForm initialAccent={resolveAccent(operator.accentColor)} />
        </Card>

        <Card
          header={
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium text-heading">Session</span>
            </div>
          }
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Signed in as</dt>
              <dd className="mt-0.5 text-sm text-foreground">{operator.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Last sign-in</dt>
              {/* PlatformUser.lastLoginAt — a real column, written by the
                  platform login route. Null until the first sign-in, which
                  formatDate renders as an em dash. */}
              <dd className="mt-0.5 text-sm text-foreground">
                {formatDate(operator.lastLoginAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Password</dt>
              <dd className="mt-0.5">
                {operator.mustChangePassword ? (
                  <StatusBadge label="Change required" variant="warning" size="sm" />
                ) : (
                  <StatusBadge label="Set by you" variant="success" size="sm" />
                )}
              </dd>
            </div>
          </dl>

          {/* No token, no cookie name, no session id and no expiry claim is
              rendered. Everything above is an account fact the operator may
              read about themselves; the credential itself is never displayed. */}
        </Card>

        <Card
          header={
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium text-heading">Change password</span>
            </div>
          }
        >
          {/* The same component and the same endpoint the forced-change page
              uses, so the policy — current password required, minimum 12, must
              differ — is enforced in one place. onSuccess="stay" because this
              operator chose to be here; the forced flow keeps its redirect. */}
          <ChangePasswordForm onSuccess="stay" />
        </Card>

        <Card
          header={
            <div className="flex items-center gap-2">
              <LogOut className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium text-heading">Sign out</span>
            </div>
          }
        >
          <p className="mb-4 text-sm text-muted-foreground">
            Ends this session on this device and returns you to the platform sign-in.
          </p>
          <SignOutButton />
        </Card>
      </div>
    </>
  );
}
