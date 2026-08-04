"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/providers/ToastProvider";
import { setCurrentAcademicYearAction } from "@/actions/calendar";

/**
 * Promotes one academic year to current.
 *
 * A one-field write, so it gets a direct button rather than a form — routing it
 * through the edit dialog would make the commonest action on this screen the
 * slowest.
 *
 * No confirmation dialog: the change is immediately visible in the table and
 * trivially reversible by promoting a different year. Confirmations belong on
 * actions that destroy something.
 */
export function SetCurrentYearButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    setIsPending(true);
    const result = await setCurrentAcademicYearAction(id);
    setIsPending(false);

    if (!result.success) {
      toast({ variant: "error", title: "Couldn't update", description: result.error });
      return;
    }

    toast({ variant: "success", title: `${name} is now the current year` });
    // Re-runs the server page so every other year's badge clears too — the
    // action demotes the previous current year, and that change is only visible
    // after a refetch.
    router.refresh();
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      isLoading={isPending}
      leftIcon={<CheckCircle2 className="size-4" />}
    >
      Set current
    </Button>
  );
}
