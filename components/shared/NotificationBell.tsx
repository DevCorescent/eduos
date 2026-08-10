import Link from "next/link";
import { Bell } from "lucide-react";
import { getUnreadNotifications } from "@/services/notifications";

/**
 * The top-bar notification bell and its unread badge.
 *
 * A SERVER COMPONENT, ON PURPOSE
 *   It reads the API during the layout's own render, so the count arrives with
 *   the page rather than after it — no loading flicker, no client fetch, and no
 *   session cookie handling in the browser. It is rendered by each portal
 *   layout (a Server Component) and passed into PortalShell's topbarActions
 *   slot, because PortalShell itself is the client boundary.
 *
 * WHY /unread AND NOT THE LIST
 *   GET /api/notifications/unread returns `unreadCount` computed over the WHOLE
 *   unread set, plus a short preview. Asking for the full list to render a
 *   badge would move a page of rows over the wire for a number, and counting
 *   one page would under-report the moment there is more than one. `limit: 1`
 *   keeps the preview payload to the minimum the route will return, since the
 *   bell shows only the count.
 *
 * A FAILED COUNT RENDERS THE BELL WITHOUT A BADGE
 *   Not an error state: the bell is chrome on every page in the product, and a
 *   notification service blip must not put an error banner on top of an
 *   otherwise working screen. The link still works, and /notifications renders
 *   the real failure with the right treatment when the reader follows it. A
 *   role outside NOTIFICATION_CENTER_ROLES gets a 403 here and simply sees no
 *   badge — the same quiet outcome, for a different reason.
 */
export async function NotificationBell() {
  const result = await getUnreadNotifications(1);
  const count = result.success ? result.data.unreadCount : 0;

  // Two hundred unread is not a number anyone acts on, and a four-digit badge
  // would not fit the dot it sits in.
  const label = count > 99 ? "99+" : String(count);

  return (
    <Link
      href="/notifications"
      aria-label={
        count === 0
          ? "Notifications"
          : `Notifications, ${count} unread`
      }
      className="relative flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bell className="size-5" aria-hidden="true" />

      {count > 0 && (
        <span
          // Tertiary, the palette's attention colour — the same ramp every
          // pending and warning state uses. Not a new red: an unread
          // notification is something waiting, not something wrong.
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex min-w-[1.125rem] items-center justify-center rounded-full bg-tertiary-500 px-1 text-[10px] font-semibold leading-[1.125rem] text-tertiary-900"
        >
          {label}
        </span>
      )}
    </Link>
  );
}
