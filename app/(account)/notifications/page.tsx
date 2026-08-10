import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import {
  getUnreadNotifications,
  listNotifications,
  NOTIFICATION_PAGE_SIZE,
} from "@/services/notifications";
import {
  NOTIFICATION_CATEGORY_OPTIONS,
  categoryLabel,
  categoryVariant,
} from "@/constants/notificationLabels";
import type { NotificationCategory } from "@/app/generated/prisma/enums";
import { formatDateTime } from "@/utils/format";
import { NotificationActions } from "./NotificationActions";
import { MarkAllReadButton } from "./MarkAllReadButton";

export const metadata: Metadata = { title: "Notifications" };

type SearchParams = Promise<{
  category?: string;
  unreadOnly?: string;
  archived?: string;
  page?: string;
}>;

/**
 * The notification centre, shared by every signed-in role.
 *
 * WHY IT LIVES IN (account) AND NOT IN A PORTAL
 *   GET /api/notifications is guarded by requireNotificationAccess over
 *   NOTIFICATION_CENTER_ROLES, which spans SUPER_ADMIN through STUDENT and
 *   PARENT. A notification is addressed to a person, not to a portal, so the
 *   screen belongs to the one layout with no role gate beyond "is signed in" —
 *   the same reasoning that puts Settings there. The (account) layout picks the
 *   right sidebar from the reader's own roles, so a lecturer sees this inside
 *   the faculty portal and a registrar inside the university one.
 *
 * WHY IT REPLACES THE OLD STUDENT PAGE
 *   /student/notifications read GET /api/student/dashboard, and its header
 *   explained why: /api/notifications used to be requireRole
 *   ("UNIVERSITY_ADMIN") and answered a student 403. Phase 27 changed the
 *   guard, verified live. The workaround cost pagination, an unread count and
 *   any way to mark something read; all three come back here.
 *
 * TWO REQUESTS, ISSUED TOGETHER
 *   The list and the unread count are independent, so they go out in parallel
 *   rather than one after the other. The count comes from /unread because it is
 *   computed over the whole unread set — counting the returned page would
 *   under-report it the moment there is more than one page.
 *
 * ALL THREE FILTERS ARE REAL. Category, unread-only and archived were each
 * checked against the running route: an invalid category answers 400, so does
 * `unreadOnly=maybe`, and so does an unknown parameter, because the schema is
 * strict. No control here is decorative.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const currentPage = Math.max(1, Number(params.page) || 1);
  const category = params.category as NotificationCategory | undefined;
  const unreadOnly = params.unreadOnly === "true";
  const archived = params.archived === "true";

  const [result, unread] = await Promise.all([
    listNotifications({
      page: currentPage,
      limit: NOTIFICATION_PAGE_SIZE,
      category,
      unreadOnly: unreadOnly ? true : undefined,
      archived: archived ? true : undefined,
    }),
    getUnreadNotifications(1),
  ]);

  const header = (
    <PageHeader
      title="Notifications"
      subtitle="Everything your institution has sent you."
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

  const { items, pagination } = result.data;

  // A failed count must not fail the page: the list is the screen and the badge
  // is a detail. Zero simply hides the sweep control rather than claiming there
  // is nothing unread.
  const unreadCount = unread.success ? unread.data.unreadCount : 0;
  const hasFilters = Boolean(category) || unreadOnly || archived;

  const preservedParams = {
    ...(category ? { category } : {}),
    ...(unreadOnly ? { unreadOnly: "true" } : {}),
    ...(archived ? { archived: "true" } : {}),
  };

  return (
    <>
      {header}

      <ListToolbar
        filters={
          <>
            <ListFilter
              paramKey="category"
              label="Category"
              hideLabel
              allLabel="All categories"
              options={NOTIFICATION_CATEGORY_OPTIONS}
            />
            <ListFilter
              paramKey="unreadOnly"
              label="Read state"
              hideLabel
              allLabel="Read and unread"
              options={[{ value: "true", label: "Unread only" }]}
            />
            <ListFilter
              paramKey="archived"
              label="Archive"
              hideLabel
              allLabel="Inbox"
              options={[{ value: "true", label: "Archived" }]}
            />
          </>
        }
        action={<MarkAllReadButton category={category} unreadCount={unreadCount} />}
      />

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Bell />}
            title={hasFilters ? "Nothing matches these filters" : "No notifications"}
            description={
              hasFilters
                ? "Try a different category, or clear the filters to see everything."
                : "Notices about your attendance, assignments, results and fees will appear here."
            }
          />
        </Card>
      ) : (
        // A list rather than a table: each entry is a message with a body, not a
        // row of comparable fields, and <ul> is what a reader's screen reader
        // should be told this is.
        <ul className="flex flex-col gap-3">
          {items.map((notification) => (
            <li key={notification.id}>
              <Card
                // The unread accent uses the Secondary ramp, the same token the
                // sidebar and every "active" state use. Unread is a state, and
                // it wears the state colour rather than one of its own.
                className={
                  notification.isRead ? undefined : "border-l-4 border-l-secondary-500"
                }
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={categoryVariant(notification.category)} size="sm">
                        {categoryLabel(notification.category)}
                      </Badge>

                      {!notification.isRead && (
                        <Badge variant="success" size="sm" withDot>
                          Unread
                        </Badge>
                      )}

                      {notification.isArchived && (
                        <Badge variant="neutral" size="sm">
                          Archived
                        </Badge>
                      )}
                    </div>

                    {notification.subject && (
                      <p className="mt-2 font-medium text-heading">
                        {notification.subject}
                      </p>
                    )}

                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {notification.body}
                    </p>

                    <p className="mt-2 text-xs text-muted-foreground">
                      <time dateTime={notification.createdAt}>
                        {formatDateTime(notification.createdAt)}
                      </time>
                      {/* sentAt is deliberately not shown as a delivery time.
                          Nothing in this project transmits, and the emitter
                          leaves sentAt null rather than claiming otherwise. */}
                    </p>
                  </div>

                  <NotificationActions
                    id={notification.id}
                    isRead={notification.isRead}
                    isArchived={notification.isArchived}
                    subject={notification.subject ?? "this notification"}
                  />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {pagination.totalPages > 1 && (
        <div className="mt-6 flex justify-center">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            basePath="/notifications"
            searchParams={preservedParams}
          />
        </div>
      )}
    </>
  );
}
