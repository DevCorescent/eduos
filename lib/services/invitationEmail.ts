// ============================================================================
// MODULE : Services — Invitation email
// LAYER  : Pure template. No network, no database, no environment.
// PURPOSE: Compose the message an invited user receives.
//
// WHY THIS EXISTS — tester issue #36
//   "The user is created successfully, but the invitation email is not received
//   by the invited user." It was not received because nothing sent it: POST
//   /api/users created the row and returned. There was no trigger, no template
//   and no failure — the feature was never wired. The button said "Invite user"
//   and the flow was "create an account".
//
//   This is not a mail-configuration fault. lib/services/mail.ts has worked
//   since tester issue #15 and is reused here unchanged; no second email system
//   is introduced.
//
// WHAT THIS DELIBERATELY DOES NOT CARRY
//   THE TEMPORARY PASSWORD. The administrator types one on the invite form, and
//   putting it in this message would leave a working credential sitting in an
//   inbox indefinitely — POST /api/users does not set mustChangePassword, so
//   nothing would ever force it to be replaced, and changing that would alter
//   invitation behaviour beyond fixing the missing email.
//
//   The message is still complete without it: the recipient learns an account
//   exists, which institution it belongs to, which address is their username,
//   and where to sign in — and password reset has existed since issue #15, so
//   they can set their own password without the administrator relaying anything.
//
//   NO TOKEN either. This product has no invite-token endpoint (the invite form
//   says so in its own comment), so there is none to embed — and a link
//   carrying one would be a credential in an inbox by another name.
//
// EVERY VALUE HERE IS SERVER-RESOLVED
//   The caller passes the tenant name read from the database via requireTenant,
//   the address read back from the created User row, and an origin the tenant
//   guard has already proven belongs to this tenant. Nothing is taken from the
//   raw request body, so an invitation cannot be addressed or branded using
//   another tenant's data.
// ============================================================================

/** What the message needs to say who this is for and where to go. */
export interface InvitationEmailInput {
  /** The institution's own name, from the tenant row. Never client-supplied. */
  readonly tenantName: string;
  /** The address the account signs in with, read back from the created row. */
  readonly email: string;
  /** Absolute sign-in URL on the tenant's own host, e.g. https://demo.eduos.com/login. */
  readonly signInUrl: string;
}

/**
 * The invitation message.
 *
 * Plain text only, matching resetCodeEmail and what MailMessage carries. A
 * second HTML body would be a second thing to keep in step for no gain here.
 */
export function invitationEmail(input: InvitationEmailInput): {
  subject: string;
  text: string;
} {
  return {
    subject: `You have been invited to ${input.tenantName}`,
    text: [
      `An account has been created for you at ${input.tenantName}.`,
      "",
      `Sign in at: ${input.signInUrl}`,
      `Your username is: ${input.email}`,
      "",
      // The administrator who created the account chose the initial password
      // and is expected to pass it on. Naming the alternative means a recipient
      // who never receives it is not stuck.
      "Use the temporary password your administrator gave you, and change it once you are signed in.",
      "",
      'If you do not have it, choose "Forgot password" on the sign-in page to set your own.',
      "",
      "If you were not expecting this invitation, you can ignore this message.",
    ].join("\n"),
  };
}
