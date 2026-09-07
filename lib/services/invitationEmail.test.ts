// ============================================================================
// TESTS: Invite User sends an invitation email — tester issue #36.
//
// THE DEFECT
//   "The user is created successfully, but the invitation email is not received
//   by the invited user." It was not received because NOTHING SENT IT. POST
//   /api/users created the row and returned; there was no trigger, no template,
//   and no failure to diagnose. The tester's suggested causes — mail service,
//   configuration, delivery — were all sound and all irrelevant:
//   lib/services/mail.ts has worked since tester issue #15, and no caller
//   existed.
//
//   THE FIRST SUITE BELOW IS THE ONE THAT WOULD HAVE CAUGHT IT.
//
// WHAT IS ASSERTED WHERE
//   invitationEmail is pure and is called for real. sendMail is exercised
//   against its own development outbox, which is what that outbox exists for
//   (see lib/services/mail.ts). The route reaches a database and this suite has
//   none — see package.json — so its wiring is pinned as source contracts, and
//   real delivery is covered by live verification against the running API.
//
// NOTHING HERE FAKES A SEND. The outbox assertions below prove a message was
// COMPOSED and handed to the mail service; they never claim SMTP delivered it,
// and `delivered` is asserted false in exactly the case where nothing left the
// building.
// ============================================================================

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { invitationEmail } from "./invitationEmail";
import { clearOutbox, isMailConfigured, readOutbox, sendMail } from "./mail";
import { createUserSchema } from "@/lib/validations/user";

const route = readFileSync(join(process.cwd(), "app/api/users/route.ts"), "utf8");
const action = readFileSync(join(process.cwd(), "actions/users.ts"), "utf8");
const facultyService = readFileSync(join(process.cwd(), "services/faculty.ts"), "utf8");
const studentService = readFileSync(join(process.cwd(), "services/students.ts"), "utf8");

/** One handler's body, so an assertion cannot be satisfied by a sibling. */
function handlerBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start > 0, `${name} must exist`);

  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

const post = handlerBody(route, "POST");

const INPUT = {
  tenantName: "Demo University",
  email: "ananya.rao@university.edu",
  signInUrl: "https://demo.eduos.test/login",
};

// ============================================================================
// THE REGRESSION — an invitation is actually triggered.
// ============================================================================

describe("#36 — the invitation is sent, which it never was", () => {
  it("the route calls sendMail", () => {
    // Before the fix this endpoint contained no mail reference of any kind.
    assert.match(post, /await sendMail\(\{ to: user\.email, subject, text \}\)/);
  });

  it("it imports the EXISTING mail service, not a second one", () => {
    // lib/services/mail.ts is the project's only transmit path and has been
    // since tester issue #15. A second email system here would be two things to
    // configure and two to fail.
    assert.match(route, /import \{ sendMail \} from "@\/lib\/services\/mail"/);
    assert.match(route, /import \{ invitationEmail \} from "@\/lib\/services\/invitationEmail"/);
  });

  it("the Invite User action opts in", () => {
    assert.match(action, /sendInvitation: true/);
  });

  it("the schema accepts the flag", () => {
    const parsed = createUserSchema.safeParse({
      email: "a@b.test",
      password: "Sup3rSecret!",
      firstName: "A",
      lastName: "B",
      sendInvitation: true,
    });

    assert.ok(parsed.success);
    assert.equal(parsed.data.sendInvitation, true);
  });
});

// ============================================================================
// SCOPE — only the invite flow mails. The other three are untouched.
// ============================================================================

describe("#36 — the three sibling flows are unchanged", () => {
  it("the flag is OPT-IN: absent means no send", () => {
    const parsed = createUserSchema.safeParse({
      email: "a@b.test",
      password: "Sup3rSecret!",
      firstName: "A",
      lastName: "B",
    });

    assert.ok(parsed.success);
    assert.equal(parsed.data.sendInvitation, undefined);
  });

  it("the route sends ONLY when the flag is set", () => {
    assert.match(post, /if \(sendInvitation\) \{/);
    assert.ok(
      post.indexOf("if (sendInvitation)") < post.indexOf("await sendMail("),
      "the send must sit inside the opt-in branch"
    );
  });

  it("Add Faculty and Add Employee do not opt in", () => {
    assert.ok(!/sendInvitation/.test(facultyService));
  });

  it("Enrol Student does not opt in", () => {
    assert.ok(!/sendInvitation/.test(studentService));
  });

  it("the flag is not written to the User row", () => {
    // Pulled out of the spread; leaving it in `profile` would send it straight
    // into prisma.user.create against a column that does not exist.
    assert.match(post, /const \{ password, sendInvitation, \.\.\.profile \} = parsed\.data;/);
  });
});

// ============================================================================
// IDENTITY — every value is server-resolved.
// ============================================================================

describe("#36 — nothing about the recipient comes from the request body", () => {
  it("the recipient is read back from the CREATED ROW", () => {
    // `user.email`, not `profile.email`. The row is the server's own record of
    // who was created; the body is a claim.
    assert.match(post, /to: user\.email/);
    assert.ok(
      !/to: profile\.email/.test(post) && !/to: parsed\.data\.email/.test(post),
      "the address must not be taken from the parsed body"
    );
  });

  it("the institution comes from the tenant the guard resolved", () => {
    assert.match(post, /tenantName: tenant\.name/);
    assert.ok(
      !/tenantName: (parsed|profile|body)/.test(post),
      "a client must not be able to brand an invitation as another university"
    );
  });

  it("the sign-in link is built from the request origin the tenant guard proved", () => {
    assert.match(post, /signInUrl: `\$\{request\.nextUrl\.origin\}\/login`/);
  });

  it("the send happens AFTER the row exists", () => {
    assert.ok(
      post.indexOf("prisma.user.create") < post.indexOf("await sendMail("),
      "a mail relay being down must not roll back a created account"
    );
  });
});

// ============================================================================
// THE MESSAGE.
// ============================================================================

describe("#36 — what the invited person receives", () => {
  it("names the institution in the subject", () => {
    const { subject } = invitationEmail(INPUT);
    assert.match(subject, /Demo University/);
    assert.match(subject, /invited/i);
  });

  it("carries the sign-in URL and the username", () => {
    const { text } = invitationEmail(INPUT);
    assert.match(text, /https:\/\/demo\.eduos\.test\/login/);
    assert.match(text, /ananya\.rao@university\.edu/);
  });

  it("tells them how to get in without the administrator relaying anything", () => {
    // Password reset has existed since tester issue #15, so a recipient who
    // never receives the temporary password is not stuck.
    assert.match(invitationEmail(INPUT).text, /Forgot password/i);
  });

  it("carries NO password", () => {
    // The administrator types a temporary password on the invite form. Putting
    // it here would leave a working credential in an inbox indefinitely —
    // POST /api/users does not set mustChangePassword, so nothing would force
    // it to be replaced.
    const composed = invitationEmail(INPUT);
    const body = `${composed.subject}\n${composed.text}`.toLowerCase();

    assert.ok(!body.includes("sup3rsecret"), "no credential may appear");
    // The word may appear as guidance ("the temporary password your
    // administrator gave you"); a VALUE may not. The template takes no password
    // parameter at all, which is the real guarantee.
    assert.ok(
      !/password[:=]\s*\S/.test(composed.text),
      "no password value may be stated"
    );
  });

  it("takes no password or token parameter at all", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/services/invitationEmail.ts"),
      "utf8"
    );
    const iface = source.slice(
      source.indexOf("export interface InvitationEmailInput"),
      source.indexOf("}", source.indexOf("export interface InvitationEmailInput"))
    );

    assert.ok(!/password/i.test(iface), "the template cannot receive a password");
    assert.ok(!/token/i.test(iface), "the template cannot receive a token");
  });

  it("is plain text, matching resetCodeEmail", () => {
    const composed = invitationEmail(INPUT);
    assert.equal(typeof composed.text, "string");
    assert.ok(!/<html|<div|<a /i.test(composed.text));
  });
});

// ============================================================================
// DELIVERY HANDLING — no misleading success, no fake success.
// ============================================================================

describe("#36 — a failed send is not reported as an invitation", () => {
  it("the success message says invited, the failure message says it was not sent", () => {
    assert.match(post, /message = "User invited"/);
    assert.match(post, /message = "User created, but the invitation email could not be sent"/);
  });

  it("the account is still created either way — 201, not a rollback", () => {
    assert.match(post, /ok\(user, message\), \{ status: 201 \}/);
    assert.ok(
      !/delivery\.delivered[\s\S]{0,200}status: (4|5)\d\d/.test(post),
      "a delivery failure must not turn a created account into an error"
    );
  });

  it("branches on the delivered flag rather than assuming success", () => {
    assert.match(post, /if \(delivery\.delivered\)/);
  });

  it("the provider's reason goes to the log, never the response body", () => {
    // It can name the recipient and the relay host — the same rule
    // POST /api/auth/forgot-password follows.
    assert.match(post, /console\.error\("\[POST \/api\/users\] invitation delivery failed:", delivery\.reason\)/);
    assert.ok(
      !/error: [\s\S]{0,40}delivery\.reason/.test(post),
      "the reason must not reach the caller"
    );
  });

  it("logs no credential and no token", () => {
    const logged = [...post.matchAll(/console\.error\(([^)]*)\)/g)].map((m) => m[1]).join(" ");
    assert.ok(!/password/i.test(logged), "no password may be logged");
    assert.ok(!/\btoken\b/i.test(logged), "no token may be logged");
  });
});

// ============================================================================
// THE MAIL SERVICE — reused, and honest when unconfigured.
// ============================================================================

describe("#36 — sendMail behaviour the invite depends on", () => {
  beforeEach(() => clearOutbox());

  it("captures rather than pretending when SMTP is unconfigured", async (t) => {
    if (isMailConfigured()) {
      t.skip("SMTP is configured in this environment; the outbox path is not exercised");
      return;
    }

    const { subject, text } = invitationEmail(INPUT);
    const result = await sendMail({ to: INPUT.email, subject, text });

    // NOT delivered — the fallback is a capture, not a pretence. This is the
    // distinction between "the provider is off in development" and a bug, and
    // it is why the route's message says the mail was not sent.
    assert.equal(result.delivered, false);
    assert.equal(readOutbox().length, 1);
    assert.equal(readOutbox()[0].to, INPUT.email);
    assert.match(readOutbox()[0].subject, /Demo University/);
  });

  it("never throws, so a relay failure cannot become an error page", async () => {
    // The route calls this after the account is committed; an exception here
    // would report a created user as a 500.
    await assert.doesNotReject(() =>
      sendMail({ to: "someone@example.test", subject: "s", text: "t" })
    );
  });

  it("reports configuration honestly", () => {
    assert.equal(typeof isMailConfigured(), "boolean");
  });
});
