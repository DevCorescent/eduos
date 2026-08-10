"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { markAllNotificationsReadAction } from "@/actions/notifications";
import type { NotificationCategory } from "@/app/generated/prisma/enums";

/**
 * "Mark all read", scoped to whatever the reader is currently looking at.
 *
 * THE CATEGORY IS PASSED THROUGH DELIBERATELY
 *   The route accepts an optional category, and the filter the reader has
 *   applied is handed to it. Sweeping every category while the screen shows one
 *   would clear notifications they have not seen and cannot get back to — the
 *   button would do more than it says.
 *
 * Disabled when there is nothing unread, because a control that performs no
 * work should not look available.
 */
export function MarkAllReadButton({
  category,
  unreadCount,
}: {
  category?: NotificationCategory;
  unreadCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (unreadCount === 0) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await markAllNotificationsReadAction(category);
            if (result.success) {
              router.refresh();
              return;
            }
            setError(result.error ?? "Could not mark these as read.");
          });
        }}
      >
        <CheckCheck className="size-4" aria-hidden="true" />
        {pending
          ? "Marking…"
          : category
            ? `Mark ${unreadCount} read in this category`
            : `Mark all ${unreadCount} read`}
      </Button>

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
