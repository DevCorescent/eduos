import type { CSSProperties, ReactNode } from "react";
import { UNIVERSITY_THEME_TOKENS, type UniversityTheme } from "@/lib/domain/tenant/theme";

/**
 * Paint one university's theme onto its portal subtree.
 *
 * WHY A WRAPPER AND NOT :root
 *   Custom properties inherit, so setting them on ONE element reaches that
 *   element's descendants and nothing else. The tenant portals render inside
 *   this; the platform console does not, and neither do the sign-in pages, so
 *   both keep resolving every token from :root exactly as they did before this
 *   feature existed. A university theme therefore cannot escape its own portal,
 *   and one university's colours can never reach another's — a different
 *   request renders a different wrapper from a different tenant's row.
 *
 * WHY INLINE STYLE RATHER THAN A STYLESHEET BLOCK
 *   The platform accent is one of six fixed choices, so it is a data attribute
 *   selecting a prewritten block. A university colour is arbitrary, so its
 *   value has to travel with the element. That is safe because of what CAN be
 *   in it: every value passed here has been through resolveUniversityTheme,
 *   which returns a member of the closed token set whose value matched
 *   /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/ or the product default. A hex colour
 *   cannot contain a brace, a semicolon, a url() or a javascript: scheme, so
 *   nothing that reaches this object can close a declaration and open another.
 *
 *   The keys are not caller-supplied either: they come from
 *   UNIVERSITY_THEME_TOKENS, not from the row, so a rogue key in
 *   Tenant.settings cannot become a custom property.
 *
 * `display: contents` so the wrapper introduces no box of its own — the shell's
 * own layout is untouched and nothing shifts by a pixel.
 */
export function UniversityTheme({
  theme,
  children,
}: {
  theme: UniversityTheme;
  children: ReactNode;
}) {
  const style = Object.fromEntries(
    UNIVERSITY_THEME_TOKENS.map((token) => [token.cssVariable, theme[token.key]])
  ) as CSSProperties;

  return (
    <div data-university-theme="" style={style} className="contents">
      {children}
    </div>
  );
}
