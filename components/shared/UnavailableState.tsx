import type { ReactNode } from "react";
import { Construction } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE THIRD STATE: a feature the backend does not implement yet.
 *
 * This project now distinguishes three situations that all end with a panel
 * containing no rows. They look alike and mean entirely different things, and
 * conflating them is what makes software feel untrustworthy — a user should
 * never have to guess which of these they are looking at:
 *
 *   EmptyState        — THE QUERY SUCCEEDED AND YOU HAVE NOTHING.
 *                       "You don't have any assignments right now."
 *                       Nothing is wrong. The answer is zero. Often the reader
 *                       can change it, so this state usually carries an action.
 *
 *   ErrorState        — THE QUERY FAILED. It might work in a moment.
 *                       "Assignment service is currently unavailable."
 *                       Something IS wrong, it is probably temporary, and
 *                       retrying is reasonable.
 *
 *   UnavailableState  — THERE IS NO QUERY TO MAKE. (this component)
 *                       "Timetable will appear once the backend exposes it."
 *                       Nothing is broken and nothing is empty: the capability
 *                       does not exist yet. Retrying will never help, so this
 *                       state offers no retry, and it names what is missing so
 *                       the reader knows what would change it.
 *
 * Using EmptyState for this case is the specific mistake it exists to prevent:
 * "No timetable" tells a student their timetable is empty, and they go looking
 * for the administrator who forgot to publish it.
 */
export interface UnavailableStateProps {
  /** What is not available. Name the feature, not the failure. */
  title: string;
  /**
   * What is missing and what would change it.
   *
   * Write it for the reader. A student is told the capability is not built yet;
   * an administrator can usefully be told which endpoint it needs.
   */
  description: string;
  /** Defaults to a construction glyph — deliberately unlike the empty-state icon. */
  icon?: ReactNode;
  /**
   * An action, for the one variant that has one.
   *
   * Almost every unavailable state is unactionable by definition — that is what
   * separates it from an error. The exception is an ended session, where the
   * reader can fix it themselves with a single link, so the slot exists rather
   * than forcing that case into a different component.
   */
  children?: ReactNode;
  className?: string;
}

export function UnavailableState({
  title,
  description,
  icon,
  children,
  className,
}: UnavailableStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center gap-3 px-6 py-10 text-center", className)}
    >
      {/* Tertiary, not Secondary or an error red. This is neither success nor
          failure, and the palette should say so before the text does. */}
      <span className="flex size-12 items-center justify-center rounded-full bg-tertiary-200 text-tertiary-800">
        {icon ?? <Construction className="size-6" aria-hidden="true" />}
      </span>

      <div className="max-w-sm">
        <p className="text-sm font-semibold text-heading">{title}</p>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>

      {children}
    </div>
  );
}
