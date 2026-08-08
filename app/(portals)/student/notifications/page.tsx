import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Bell } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getPortalSession } from "@/services/session";
import { getMyDashboard } from "@/services/studentProfile";
import { formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Notifications" };

/**
 * Student notifications.
 *
 * Read from GET /api/student/dashboard, NOT from /api/notifications: that
 * collection is requireRole("UNIVERSITY_ADMIN") and answers a student 403 —
 * verified against the running API. The dashboard endpoint returns the same
 * student's own notifications as part of its payload, which is the only path a
 * student is permitted.
 *
 * The consequence is a real limitation, stated rather than hidden: the list is
 * bounded by what the dashboard returns and there is no pagination, so this
 * page shows recent notifications rather than all of them.
 *
 * All three states are distinguished here, which is the point of the trio:
 * a failed request says the SERVICE is unavailable; a successful request with
 * nothing in it says the student has no notifications.
 */
export default async function StudentNotificationsPage() {
  const session = await getPortalSession();
  if (!session) redirect("/login");

  const result = await getMyDashboard(NOTIFICATION_LIMIT);

  const header = (
    <PageHeader
      title="Notifications"
      subtitle="Recent messages from your institution."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(result)}
          subject="notifications"
          message={result.error}
        />
      </>
    );
  }

  const notifications = result.data.notifications;

  return (
    <>
      {header}

      <Card noPadding>
        {notifications.length === 0 ? (
          <EmptyState
            icon={<Bell />}
            title="You're all caught up"
            description="You don't have any notifications right now."
          />
        ) : (
          <ul className="divide-y divide-border">
            {notifications.map((notification) => (
              <li key={notification.id} className="flex gap-3 px-5 py-4">
                <span
                  className={
                    notification.isRead
                      ? "mt-2 size-2 shrink-0 rounded-full bg-neutral-300"
                      : "mt-2 size-2 shrink-0 rounded-full bg-secondary-600"
                  }
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {notification.subject ?? "Notification"}
                    </p>
                    <Badge variant="neutral" size="sm">
                      {notification.type}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
                  {notification.sentAt && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(notification.sentAt)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

/**
 * How many notifications the dashboard endpoint is asked for.
 *
 * Bounded by that endpoint's own validation rather than chosen freely — it
 * refuses zero (a silently empty panel) and caps the upper end.
 */
const NOTIFICATION_LIMIT = 20;
