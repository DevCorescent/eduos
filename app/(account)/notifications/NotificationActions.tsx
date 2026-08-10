"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  deleteNotificationAction,
  markNotificationReadAction,
} from "@/actions/notifications";

/**
 * The per-row controls: mark read, archive, delete.
 *
 * A client component because these are the only interactive parts of an
 * otherwise server-rendered list — the rows, the filters and the pagination all
 * stay on the server, so the JavaScript shipped is three buttons rather than a
 * page.
 *
 * WHY EACH ROW OWNS ITS OWN PENDING AND ERROR STATE
 *   A reader clears several notifications in a row. One shared spinner would
 *   disable every button on the page while one request is in flight, and one
 *   shared error message would attach a failure to the wrong row. Both live
 *   here, per row, so the feedback lands where the action was taken.
 *
 * The failure is rendered, never swallowed. If marking read fails the row says
 * so and the buttons come back — a control that stays disabled after an error
 * is indistinguishable from one that is still working.
 */
export function NotificationActions({
  id,
  isRead,
  isArchived,
  subject,
}: {
  id: string;
  isRead: boolean;
  isArchived: boolean;
  /** Names the row in the buttons' accessible labels, so they are distinguishable. */
  subject: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /**
   * Runs one action and refreshes on success.
   *
   * router.refresh() re-runs the Server Component page rather than mutating a
   * local copy, so what the reader sees afterwards is what the database holds —
   * there is no client-side list that could drift from it.
   */
  function run(action: () => Promise<{ success: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.success) {
        router.refresh();
        return;
      }
      setError(result.error ?? "That did not work. Try again in a moment.");
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        {!isRead && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            aria-label={`Mark "${subject}" as read`}
            onClick={() => run(() => markNotificationReadAction(id))}
          >
            <Check className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Read</span>
          </Button>
        )}

        {!isArchived && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            aria-label={`Archive "${subject}"`}
            onClick={() => run(() => markNotificationReadAction(id, true))}
          >
            <Archive className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Archive</span>
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          aria-label={`Delete "${subject}"`}
          onClick={() => run(() => deleteNotificationAction(id))}
        >
          <Trash2 className="size-4 text-danger" aria-hidden="true" />
          <span className="hidden sm:inline">Delete</span>
        </Button>
      </div>

      {error && (
        // role="alert" so a reader using a screen reader hears the failure
        // rather than finding the row unchanged with no explanation.
        <p role="alert" className="max-w-[16rem] text-right text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
