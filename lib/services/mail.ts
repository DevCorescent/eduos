// ============================================================================
// OWNER  : —
// MODULE : Services — outbound email (SMTP)
// LAYER  : Service. Reaches the network; never called from a component.
// PURPOSE: The one place this product sends mail from.
//
// WHY SMTP AND NOT A PROVIDER SDK
//   .env.example has carried SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and
//   SMTP_FROM since the file was written, and no provider key of any kind. The
//   project's intent is plainly SMTP, so this uses it rather than introducing a
//   second, contradictory convention.
//
// UNTIL NOW NOTHING IN THIS PRODUCT SENT MAIL
//   app/api/notifications/send writes Notification rows and says so in its own
//   header: "Nothing is transmitted". That remains true — this module does not
//   change it. This is the first and, so far, only transmit path, and it exists
//   because a password reset code is worthless if it cannot reach the person.
//
// THE DEVELOPMENT FALLBACK IS A CAPTURE, NOT A PRETENCE
//   With no SMTP_HOST configured, `send` does not claim success. Outside
//   production it records the message in an in-memory outbox and returns
//   `delivered: false` with a reason, so a developer can read the code and the
//   caller still knows nothing left the building. In production a missing
//   configuration is an error, because silently dropping a reset email is worse
//   than refusing to try.
// ============================================================================

import nodemailer, { type Transporter } from "nodemailer";

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export type MailResult =
  | { readonly delivered: true; readonly messageId: string }
  | { readonly delivered: false; readonly reason: string };

/**
 * Messages captured instead of sent, newest last.
 *
 * ONLY POPULATED WHEN SMTP IS NOT CONFIGURED, AND NEVER IN PRODUCTION.
 * It exists so a password reset can be exercised end to end on a developer
 * machine without a mail server, and so tests can assert what would have been
 * sent. It is process-local and unbounded only in the sense that a dev session
 * is short; `clearOutbox` is provided for tests that want a clean slate.
 */
const outbox: MailMessage[] = [];

export function readOutbox(): readonly MailMessage[] {
  return outbox;
}

export function clearOutbox(): void {
  outbox.length = 0;
}

/** True when the environment carries enough configuration to actually send. */
export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

let cached: Transporter | null = null;

/**
 * The transport, built once.
 *
 * Rebuilding per message would open a new connection every time, which most
 * providers rate-limit long before the volume justifies it.
 */
function transport(): Transporter {
  if (cached) return cached;

  const port = Number(process.env.SMTP_PORT ?? 587);

  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS. Deriving this from the
    // port rather than adding another environment variable to get wrong.
    secure: port === 465,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });

  return cached;
}

/**
 * Send one message.
 *
 * NEVER THROWS. A caller in a request handler must be able to decide what to
 * tell the user, and an exception escaping here would become the HTML error
 * page this whole issue was reported for. Failures come back as data.
 *
 * The provider's own error text is returned for the SERVER LOG only — callers
 * must not put it in a response body, because it can name the recipient and the
 * relay host.
 */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  if (!isMailConfigured()) {
    if (process.env.NODE_ENV === "production") {
      return { delivered: false, reason: "SMTP is not configured" };
    }

    outbox.push(message);
    return { delivered: false, reason: "captured to the development outbox" };
  }

  try {
    const info = await transport().sendMail({
      from: process.env.SMTP_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });

    return { delivered: true, messageId: info.messageId };
  } catch (error) {
    return {
      delivered: false,
      reason: error instanceof Error ? error.message : "unknown transport error",
    };
  }
}
