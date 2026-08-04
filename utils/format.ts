// ============================================================================
// MODULE : Utils — Display Formatting
// PURPOSE: Dates, money and counts, formatted once so every screen agrees.
//
//          All of these run on the server as well as the client, so a fixed
//          locale is passed explicitly to every Intl call. Omitting it uses the
//          runtime's default, which differs between the Node process and the
//          browser — and that mismatch surfaces as a React hydration error on
//          any date or currency rendered in a Server Component.
// ============================================================================

/** Fixed for the reason above; the tenant's own locale is a later concern. */
const LOCALE = "en-IN";

/**
 * "12 Mar 2026". Returns an em dash for null, so callers need no ternary.
 *
 * Invalid input yields the same dash rather than "Invalid Date": these values
 * arrive as strings over the wire, so a malformed one is possible and should
 * not print as a defect on screen.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** "12 Mar 2026, 4:30 pm" — for audit trails and timestamps. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/**
 * "3 days ago", "in 2 months".
 *
 * Computed against a date passed in rather than Date.now(), because a Server
 * Component and the browser evaluate at different instants — enough to render
 * "2 hours ago" on the server and "3 hours ago" on hydration, which React
 * reports as a mismatch. Callers on a fixture pass the fixture epoch.
 */
export function formatRelative(
  value: string | null | undefined,
  now: Date = new Date()
): string {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const seconds = (date.getTime() - now.getTime()) / 1000;
  const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];

  for (const [unit, secondsPerUnit] of units) {
    if (Math.abs(seconds) >= secondsPerUnit) {
      return formatter.format(Math.round(seconds / secondsPerUnit), unit);
    }
  }

  return formatter.format(Math.round(seconds), "second");
}

/**
 * "₹1,49,999" — Indian digit grouping, no decimals.
 *
 * Accepts the string form because money arrives from a Decimal column and is
 * carried as a string end-to-end to stay exact. It is parsed only here, at the
 * point of display; nothing that settles an amount should go through this.
 */
export function formatCurrency(
  value: string | number | null | undefined,
  currency = "INR"
): string {
  if (value === null || value === undefined || value === "") return "—";

  const amount = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(amount)) return "—";

  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** "1,24,500" — a count with digit grouping. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(LOCALE).format(value);
}

/**
 * "25 GB". Takes the string form because the column is BigInt.
 *
 * Parsed with BigInt rather than Number so a petabyte-scale allocation stays
 * exact — Number loses integer precision beyond 2^53, which a byte count can
 * exceed.
 */
export function formatBytes(value: string | null | undefined): string {
  if (!value) return "—";

  let bytes: bigint;
  try {
    bytes = BigInt(value);
  } catch {
    return "—";
  }

  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let unitIndex = 0;
  let size = Number(bytes);

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size % 1 === 0 ? size : size.toFixed(1)} ${units[unitIndex]}`;
}

/** "72%" from a 0-100 value. */
export function formatPercent(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(decimals)}%`;
}
