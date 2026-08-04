// components/layout/Topbar.tsx

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";

export interface TopbarUser {
  name: string;
  email?: string;
  avatarUrl?: string;
  /** Shown under the name in the menu, e.g. "University Admin". */
  roleLabel?: string;
}

export interface TopbarMenuItem {
  label: string;
  onClick: () => void;
  /** Renders separated from items above it with a divider, and in danger color. */
  destructive?: boolean;
}

export interface TopbarProps {
  /**
   * Optional page title.
   *
   * Usually omitted: pages render their own <PageHeader>, and repeating the
   * title in the bar as well would state it twice on every screen. Useful when
   * a page has no header of its own.
   */
  title?: string;
  user: TopbarUser;
  menuItems: TopbarMenuItem[];
  /**
   * Rendered at the far left, before the title — the shell puts the mobile
   * sidebar toggle here. Kept as a slot so Topbar itself owns no sidebar state.
   */
  leading?: ReactNode;
  /** Rendered between the title and the user menu, e.g. a breadcrumb. */
  center?: ReactNode;
  /** Extra actions left of the user menu, e.g. a notifications bell. */
  actions?: ReactNode;
}

/**
 * Top bar carrying the mobile nav toggle, an optional title or breadcrumb, and
 * the user menu.
 *
 * The user menu is a real popup (`role="menu"`) rather than a styled dropdown:
 * it closes on outside click and on Escape, and returns focus to its trigger,
 * so it is operable by keyboard alone.
 *
 * `"use client"` is required for the open/close state and outside-click
 * detection.
 *
 * @example
 * ```tsx
 * <Topbar
 *   leading={<MobileNavToggle onClick={openSidebar} />}
 *   center={<PortalBreadcrumb />}
 *   user={{ name: "Priya Sharma", email: "priya@uni.edu" }}
 *   menuItems={[{ label: "Log out", onClick: handleLogout, destructive: true }]}
 * />
 * ```
 */
export function Topbar({ title, user, menuItems, leading, center, actions }: TopbarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function onClickOutside(e: MouseEvent) {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  return (
    <header className="glass-plain sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-4 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {leading}
        {title && (
          <h1 className="truncate text-base font-semibold text-heading">{title}</h1>
        )}
        {/* Hidden on small screens: the breadcrumb competes with the toggle and
            the avatar for a width that cannot hold all three. */}
        {center && <div className="hidden min-w-0 sm:block">{center}</div>}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {actions}

        <div className="relative">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setIsOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            aria-label="Open user menu"
            className="flex items-center gap-2 rounded-md p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Avatar name={user.name} src={user.avatarUrl} size="sm" />
          </button>

          {isOpen && (
            <div
              ref={menuRef}
              role="menu"
              aria-label="User menu"
              className="absolute right-0 top-full z-50 mt-2 w-56 rounded-md border border-border bg-surface py-1 shadow-lg"
            >
              <div className="border-b border-border px-3 py-2">
                <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
                {user.email && (
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                )}
                {user.roleLabel && (
                  <p className="mt-1 truncate text-xs font-medium text-primary">
                    {user.roleLabel}
                  </p>
                )}
              </div>

              {menuItems.map((item, i) => (
                <button
                  key={item.label}
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    item.onClick();
                  }}
                  className={cn(
                    "w-full px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:bg-muted",
                    item.destructive ? "text-danger" : "text-foreground",
                    item.destructive && i > 0 && "border-t border-border"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
