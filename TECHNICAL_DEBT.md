# Technical Debt

## Overview

- **Total confirmed items:** 56
- **Phases covered:** Phase 7 (Faculty), Phase 9 (Timetable & Attendance), Phase 10 (Assessments), Phase 11 (Finance), Phase 12 (Certificates), plus cross-phase validation findings
- **Generated after Phase 12 completion.** Every entry below was confirmed during verification — by HTTP test, database audit, migration DDL inspection, or a combination. Nothing here is speculative.

**On ID series.** Three ID series exist and are preserved verbatim, never renumbered:

| Series | Origin | Note |
| --- | --- | --- |
| `TD-001` … `TD-008` | Sequential | `TD-001`/`TD-002` were already assigned; `TD-003`–`TD-008` number items previously recorded without an ID |
| `TD-A` … `TD-E` | Phase 10 schema-limitations catalogue | Distinct from the `TD-C01`+ series below |
| `TD-C01` … `TD-C43` | Phase 12 certificates | Note `TD-C` (Phase 10, unconstrained identity columns) is a **different** item from `TD-C01` |

**Status.** All items are `Open` except `TD-001`, which carries the `Accepted` decision recorded when it was first written.

---

## Validation

### TD-002

**Phase**
Cross-phase (Phases 6–11)

**Status**
Open

**Description**
`z.coerce.date()` coerces `null`, `true` and `false` to the Unix epoch (`1970-01-01`) instead of rejecting them. Confirmed across eleven date fields, most recently `FeeDemand.dueDate` and `Examination.date`. A demand generated with `dueDate: null` is stored immediately overdue. Kept deliberately for project-wide consistency.

**Impact**
Medium

**Requires**
Code Change

### TD-005

**Phase**
Phase 10

**Status**
Open

**Description**
`ExamResult.marksObtained` is `Decimal(6,2)` (max `9999.99`) but is validated only as `z.number().nonnegative()` bounded by `marksObtained <= examination.maxMarks`. `Examination.maxMarks` is a plain `Int` with no upper bound, so an examination with a large `maxMarks` permits a result that overflows the column at the database layer.

**Impact**
High

**Requires**
Code Change

### TD-C21

**Phase**
Phase 12

**Status**
Open

**Description**
`Certificate.pdfUrl` and `qrCode` are plain nullable `TEXT` with no format rule, validated only as trimmed non-empty strings. `pdfUrl` may hold any value including a `javascript:` or `data:` URI. Any UI rendering it as a link inherits an unvalidated-redirect surface. The schema asserts nothing, so no format was invented.

**Impact**
Medium

**Requires**
Business Decision

### TD-C37

**Phase**
Phase 12

**Status**
Open

**Description**
`certificateIdParamSchema` validates a Certificate id in three routes and a **Student** id in `GET /api/students/[id]/certificates`. The contracts are identical today, so nothing is wrong; if either ever gains a format assertion, the other silently inherits it. `studentIdParamSchema` already exists and is the natural fit.

**Impact**
Low

**Requires**
Code Change

---

## Attendance

### TD-003

**Phase**
Phase 9

**Status**
Open

**Description**
`Attendance` declares `@@unique([studentId, courseId, ...])` with `courseId` nullable. PostgreSQL treats `NULL` as distinct in a unique index, so duplicate attendance records are storable whenever `courseId` is absent. This is the `TD-001` pattern on a model with far higher write volume. No application pre-check can close it without enforcing a rule the schema does not have.

**Impact**
High

**Requires**
Schema Change

---

## Assessment

### TD-A

**Phase**
Phase 10

**Status**
Open

**Description**
`AssignmentSubmission` and `ExamResult` carry no `tenantId` column — the only two models in the schema storing tenant-owned data without one. Every query must anchor ownership through a parent relation, and audit queries need two-relation joins to check an invariant the database cannot express.

**Impact**
High

**Requires**
Schema Change

### TD-B

**Phase**
Phase 10

**Status**
Open

**Description**
`Assignment.sectionId` has no foreign key and no declared relation. The column accepts any string, including another tenant's section id. Confirmed at runtime: the route's tenant-scoped lookup is the only thing producing the cross-tenant `404`, and a deleted section leaves a dangling id with no `P2003` raised.

**Impact**
Medium

**Requires**
Schema Change

### TD-C

**Phase**
Phase 10

**Status**
Open

**Description**
`Assignment.createdBy` and `AssignmentSubmission.gradedBy` are unconstrained identity columns with undeclared targets — no foreign key, no relation. `createdBy` is `NOT NULL`, so every assignment carries an unverifiable actor id. Deleting the user leaves a dangling reference. (Distinct from `TD-C01`.)

**Impact**
Medium

**Requires**
Schema Change

### TD-D

**Phase**
Phase 10

**Status**
Open

**Description**
Neither `Assignment` nor `Examination` declares any unique index beyond its primary key. Byte-identical assignments and examinations may be created without limit — demonstrated live. Two duplicate examinations each carry their own independent result set for the same student and course.

**Impact**
Medium

**Requires**
Schema Change

### TD-E

**Phase**
Phase 10

**Status**
Open

**Description**
Enum state and its companion timestamp are structurally unlinked across three pairs: `Assignment.status`/`publishedAt`, `AssignmentSubmission.status`/`submittedAt`+`gradedAt`, and `ExamResult.publishedAt`. A `SCHEDULED` examination with no date, or a partially applied transition, are both storable. Consistency is maintained only by cooperating application routes.

**Impact**
Medium

**Requires**
Schema Change

### TD-004

**Phase**
Phase 10

**Status**
Open

**Description**
No endpoint can publish an examination result. `ExamResult.publishedAt` gates student visibility, the README defines no publish route for results (unlike assignments), and nothing sets the column. Both student-facing result views are therefore permanently empty.

**Impact**
Critical

**Requires**
Business Decision

---

## Finance

### TD-006

**Phase**
Phase 11

**Status**
Open

**Description**
`FeeStructure` declares no foreign key on any column — not `programmeId`, `batchId`, `academicYearId`, nor `tenantId`. It is the widest instance of the `TD-B`/`TD-C` family at three reference columns plus tenancy. Deleting a programme, batch or academic year silently leaves dangling ids; no `P2003` is ever raised.

**Impact**
Medium

**Requires**
Schema Change

### TD-007

**Phase**
Phase 11

**Status**
Open

**Description**
`POST /api/fee-demands/generate` is deliberately not idempotent per approved business rules: no duplicate detection, no reservation, no `409`. Running generation twice for the same batch double-bills every student, and `GET /api/finance/report` counts the duplicates as stored. The behaviour is stated policy; the exposure is financial and invisible.

**Impact**
High

**Requires**
Business Decision

### TD-008

**Phase**
Phase 11

**Status**
Open

**Description**
`PATCH /api/fee-demands/[id]/waive` writes `waivedAmount` only. `FeeDemand` has no `waivedBy`, `waivedAt` or reason column, so a waiver records the amount and nothing else — not who granted it, when, or why. A financial concession is therefore unattributable.

**Impact**
High

**Requires**
Schema Change

---

## Certificates

### TD-C01

**Phase**
Phase 12

**Status**
Open

**Description**
`CertificateTemplate` declares no unique constraint of any kind — only `@@index([tenantId])`. Nothing stops duplicate names or multiple simultaneously active templates of the same type within one tenant. Certificate issuance therefore has no deterministic way to select "the" template for a type.

**Impact**
High

**Requires**
Schema Change

### TD-C04

**Phase**
Phase 12

**Status**
Open

**Description**
`CertificateTemplate.variables` is structurally unenforced and disconnected from `htmlTemplate`. A template may declare variables it never uses and use placeholders it never declares; nothing detects either. Any renderer discovers the mismatch at render time, per certificate, rather than at save time.

**Impact**
Low

**Requires**
Business Decision

### TD-C05

**Phase**
Phase 12

**Status**
Open

**Description**
`CertificateTemplate` carries no `version`, `publishedAt`, `status` or `supersededById` column, so editing a template replaces its content in place with no history. Certificates already issued reference the same `templateId`, so a reissue or re-verification after an edit cannot reproduce the original document.

**Impact**
High

**Requires**
Schema Change

### TD-C08

**Phase**
Phase 12

**Status**
Open

**Description**
Demonstrated end-to-end: three identical create bodies and five concurrent identical creates all returned `201` with distinct rows, and `pg_indexes` confirms no unique index beyond the primary key. `TD-C01` was inferred from the schema; this is the runtime proof.

**Impact**
High

**Requires**
Schema Change

### TD-C12

**Phase**
Phase 12

**Status**
Open

**Description**
`PATCH /api/certificate-templates/[id]` rewrites template content in place. The audit confirmed no history table, no snapshot column and no new migration. `Certificate.templateId` is a `RESTRICT` foreign key to the same row, so a certificate issued yesterday now points at today's markup.

**Impact**
High

**Requires**
Schema Change

### TD-C13

**Phase**
Phase 12

**Status**
Open

**Description**
`variables` is replaced wholesale on PATCH, never merged. Any update touching it must resend the entire object or the omitted keys are destroyed, with no error to signal the loss. Correct per Prisma and the schema, but a realistic data-loss path for a UI editing one variable.

**Impact**
Medium

**Requires**
Code Change

### TD-C14

**Phase**
Phase 12

**Status**
Open

**Description**
Confirmed live: two templates were PATCHed onto the same `name`, same `type`, both `isActive: true`, returning two `200`s and no `409`. The collision is reachable by edit as well as by create, so even a system deduplicating at creation could be walked into an ambiguous state afterwards.

**Impact**
Medium

**Requires**
Schema Change

### TD-C15

**Phase**
Phase 12

**Status**
Open

**Description**
`CertificateTemplate.isActive` is written and reported by both template routes, filtered on by neither, and consumed by no other endpoint. Until certificate issuance uses it, the flag is inert metadata that reads like a guarantee.

**Impact**
Low

**Requires**
Business Decision

### TD-C18

**Phase**
Phase 12

**Status**
Open

**Description**
No certificate-number generation rule exists anywhere in the schema or README — no format, sequence, checksum or prefix. Numbers are whatever the client sends, so uniqueness, non-guessability and non-reuse are entirely the caller's responsibility.

**Impact**
High

**Requires**
Business Decision

### TD-C20

**Phase**
Phase 12

**Status**
Open

**Description**
`Certificate` has no `reason`, `notes` or `remarks` column, so a revocation records who and when but never why. A supplied `reason` key is silently stripped by the issue schema. Mirrors the unattributable-waiver finding in `TD-008`.

**Impact**
Medium

**Requires**
Schema Change

### TD-C25

**Phase**
Phase 12

**Status**
Open

**Description**
Verified live: the same student, template and type issued twice, both `201`, two distinct rows. Only the certificate number distinguishes them. No schema constraint and no rule prevents it, so duplicate issuance is a silent, ordinary outcome.

**Impact**
Medium

**Requires**
Business Decision

### TD-C26

**Phase**
Phase 12

**Status**
Open

**Description**
`pdfUrl` and `qrCode` are writable and reported but nothing in the system produces either. A certificate issued today has `NULL` in both, so the artefacts the model anticipates do not exist and any populated value came from outside the system.

**Impact**
Medium

**Requires**
Business Decision

### TD-C27

**Phase**
Phase 12

**Status**
Open

**Description**
A certificate records `templateId` and `data` but no snapshot of the markup it was issued from. Combined with in-place template edits (`TD-C12`), a certificate issued before an edit can no longer be regenerated as it was. Issuance being live makes this reachable rather than theoretical.

**Impact**
High

**Requires**
Schema Change

### TD-C39

**Phase**
Phase 12

**Status**
Open

**Description**
Confirmed end-to-end: the revoke endpoint reads no request body and the model has no reason column, so a revocation reason cannot even be submitted. A revoked certificate carries no explanation anywhere in the system. Upgrades `TD-C20` from a validation-layer observation to a confirmed gap.

**Impact**
Medium

**Requires**
Schema Change

### TD-C40

**Phase**
Phase 12

**Status**
Open

**Description**
Revocation is irreversible with no correction path: no un-revoke, no `PATCH` on `Certificate`, no `DELETE`. An accidental revoke can only be remedied by direct database access or issuing a replacement under a new number. Defensible for an audit record, but the operational need is unacknowledged.

**Impact**
Medium

**Requires**
Business Decision

---

## Architecture

### TD-C07

**Phase**
Phase 12

**Status**
Open

**Description**
`GET /api/certificate-templates` accepts no filters — all thirteen tested query parameters are inert. Selecting "the active DEGREE template" requires paging a tenant's entire template set client-side. Becomes load-bearing the moment issuance needs to resolve a template.

**Impact**
Medium

**Requires**
Business Decision

### TD-C32

**Phase**
Phase 12

**Status**
Open

**Description**
`Certificate.expiresAt` is written at issuance and reported by every read endpoint, and nothing anywhere compares it to the current time. An expired certificate is indistinguishable from a current one unless the caller performs the arithmetic itself.

**Impact**
Medium

**Requires**
Business Decision

### TD-C34

**Phase**
Phase 12

**Status**
Open

**Description**
`GET /api/students/[id]/certificates` is admin-only, so a student cannot read their own certificates anywhere in the API. Every other student-owned collection (`fee-demands`, `results`, `transcript`) grants self-access. The only route a student can reach is the public verification endpoint.

**Impact**
Medium

**Requires**
Business Decision

### TD-C35

**Phase**
Phase 12

**Status**
Open

**Description**
The README defines no `GET /api/certificates` collection, so certificates are reachable only per-student or per-number. An administrator cannot enumerate what their institution has issued, making reconciliation, audit and revocation review impossible through the API.

**Impact**
High

**Requires**
Documentation

### TD-C36

**Phase**
Phase 12

**Status**
Open

**Description**
The per-student certificate list accepts no `?type` or `?isRevoked` filter — all seven tested parameters are inert. Answering "does this student hold a valid DEGREE certificate?" requires paging the full history and applying a validity rule the API does not define.

**Impact**
Medium

**Requires**
Business Decision

### TD-C38

**Phase**
Phase 12

**Status**
Open

**Description**
`Certificate.issuedAt` is stored and reported but used as neither an ordering nor a filtering key anywhere. With `expiresAt` never evaluated (`TD-C32`), two of the model's three date columns exist purely as data the client must interpret.

**Impact**
Low

**Requires**
Business Decision

### TD-C43

**Phase**
Phase 12

**Status**
Open

**Description**
There is no way to find revoked certificates. No collection endpoint exists (`TD-C35`) and the per-student list has no `?isRevoked` filter (`TD-C36`), so an administrator cannot review what has been revoked without walking every student individually.

**Impact**
Medium

**Requires**
Business Decision

---

## Security

### TD-C02

**Phase**
Phase 12

**Status**
Open

**Description**
`CertificateTemplate.htmlTemplate` accepts arbitrary markup verbatim, `<script>` included — verified byte-identical at the column level. Correct for the validation layer, since no rule authorises rewriting stored content, but it defers the entire escaping obligation to a renderer that does not yet exist.

**Impact**
High

**Requires**
Business Decision

### TD-C10

**Phase**
Phase 12

**Status**
Open

**Description**
Confirmed on the create path: `<script>alert(1)</script>` and `onerror=` handlers persist verbatim in the database through `POST /api/certificate-templates`. This is `TD-C02` demonstrated with stored evidence rather than inferred from the schema.

**Impact**
High

**Requires**
Business Decision

### TD-C16

**Phase**
Phase 12

**Status**
Open

**Description**
The same unsanitised markup persists through `PATCH /api/certificate-templates/[id]`, confirming the exposure on the update path. The stored-XSS obligation now has two entry points rather than one.

**Impact**
High

**Requires**
Business Decision

### TD-C23

**Phase**
Phase 12

**Status**
Open

**Description**
`Certificate.certificateNo` is globally unique, not tenant-scoped. Confirmed live: tenant B issuing tenant A's number receives `409 CONFLICT`. Since numbers are client-supplied, any tenant can probe the global namespace one request at a time and learn which numbers exist system-wide.

**Impact**
High

**Requires**
Schema Change

### TD-C24

**Phase**
Phase 12

**Status**
Open

**Description**
`GET /api/certificates/verify/[certNo]` is public and certificate numbers are client-chosen with no format or entropy requirement. An issuer using sequential numbers makes their entire certificate register walkable by a stranger.

**Impact**
High

**Requires**
Business Decision

### TD-C29

**Phase**
Phase 12

**Status**
Open

**Description**
The public verification endpoint returns the whole certificate row — `tenantId`, `studentId`, `templateId` and the entire unstructured `data` column — to anyone holding a number. In fixtures that column held a student name and CGPA. No rule defines a public projection, so none was invented.

**Impact**
Critical

**Requires**
Business Decision

### TD-C30

**Phase**
Phase 12

**Status**
Open

**Description**
Public verification has no rate limit, no CAPTCHA, no proof-of-possession and a uniform `404` for every miss. Combined with client-chosen numbers (`TD-C24`), an attacker can walk the number space at request speed, each hit returning the full row per `TD-C29`.

**Impact**
Critical

**Requires**
Infrastructure

### TD-C31

**Phase**
Phase 12

**Status**
Open

**Description**
A revoked certificate returns `200` from public verification, distinguished only by an `isRevoked` field the caller must notice and interpret. An integration checking only the HTTP status treats a revoked certificate as genuine. Correct per the schema, but the failure mode is silent and points the wrong way.

**Impact**
High

**Requires**
Business Decision

### TD-C33

**Phase**
Phase 12

**Status**
Open

**Description**
A certificate number verifies from any host — confirmed from the other tenant's subdomain and from the bare root domain. One university's certificate is confirmable through another's domain. Follows from the global unique constraint plus a tenant-less public route.

**Impact**
High

**Requires**
Schema Change

### TD-C42

**Phase**
Phase 12

**Status**
Open

**Description**
Now reachable end-to-end: an admin revokes a certificate and public verification continues to answer `200` with `isRevoked: true`. Confirms `TD-C31` with a live revocation behind it rather than a seeded fixture.

**Impact**
High

**Requires**
Business Decision

---

## Performance

### TD-C03

**Phase**
Phase 12

**Status**
Open

**Description**
`htmlTemplate` and `cssStyles` are unbounded Postgres `text` with no length rule in the schema or validation. A 200 KB template was accepted and stored at full length. No request-size or column-size guard exists anywhere in the chain.

**Impact**
Medium

**Requires**
Business Decision

### TD-C06

**Phase**
Phase 12

**Status**
Open

**Description**
`GET /api/certificate-templates` returns `htmlTemplate` and `cssStyles` in full, with `?limit` capped at 100 the only bound. A page of large templates is an arbitrarily large response — 100 × 200 KB is a 20 MB payload. No documented projection exists to narrow it.

**Impact**
Medium

**Requires**
Business Decision

---

## Database

### TD-001

**Phase**
Phase 7

**Status**
Accepted

**Description**
`FacultyCourseAssignment` declares `@@unique([facultyId, courseId, sectionId, semesterId])` with `sectionId` and `semesterId` nullable. PostgreSQL treats `NULL` as distinct, so duplicates are creatable when both are omitted. Measured: six concurrent POSTs produced 2 rows with both `NULL` versus 1 row with both supplied. Accepted as a schema-level limitation, not a route bug.

**Impact**
High

**Requires**
Schema Change

### TD-C09

**Phase**
Phase 12

**Status**
Open

**Description**
`variables` and `data` are `JSONB`, so Postgres normalises key order on storage and would silently deduplicate repeated keys. Every key and value survives exactly; only order moves. Harmless while the columns are unstructured metadata, but a correctness question if anything ever renders variables in declaration order.

**Impact**
Low

**Requires**
Documentation

### TD-C17

**Phase**
Phase 12

**Status**
Open

**Description**
`Certificate.certificateNo` carries a bare column-level `@unique` rather than `@@unique([tenantId, certificateNo])`. Every other unique constraint in the project is tenant-scoped. This is the schema's only cross-tenant constraint and the root cause of `TD-C23` and `TD-C33`.

**Impact**
High

**Requires**
Schema Change

### TD-C19

**Phase**
Phase 12

**Status**
Open

**Description**
`isRevoked`, `revokedAt` and `revokedBy` are three independent columns with no check constraint tying them together. `isRevoked = true` with `revokedAt = NULL` is storable. The revoke route writes all three atomically, so integrity is behavioural rather than structural — any other writer could produce an inconsistent row.

**Impact**
Medium

**Requires**
Schema Change

### TD-C22

**Phase**
Phase 12

**Status**
Open

**Description**
`Certificate` declares `createdAt` but no `updatedAt`. It is the only Phase 12 model without one. Revocation mutates a row carrying no general modification timestamp, so any future non-revocation change would be invisible to auditing.

**Impact**
Low

**Requires**
Schema Change

### TD-C28

**Phase**
Phase 12

**Status**
Open

**Description**
Confirmed after issuance went live: `issuedAt` and `createdAt` were within 1 ms of each other on every row, making the two columns redundant in practice. They can diverge only if `issuedAt` becomes writable, which the approved resolution forbids. Same concern as `TD-C22`, recorded separately as it was confirmed on a different route.

**Impact**
Low

**Requires**
Schema Change

### TD-C41

**Phase**
Phase 12

**Status**
Open

**Description**
`Certificate.revokedBy` has no foreign key to `User` — the seeded literal `"original-revoker"` persisted without complaint. Nothing joins it back to a person, and a deleted user leaves a dangling identifier. Same situation as `Assignment.createdBy` in `TD-C`.

**Impact**
Medium

**Requires**
Schema Change

---

## Environment

### TD-C11

**Phase**
Phase 12

**Status**
Open

**Description**
The Neon WebSocket connection drops repeatedly mid-run, once leaving a transaction open 602 s against a 5 s budget and surfacing as `unhandledRejection: ErrorEvent`. It produces `500 SERVER_ERROR` responses indistinguishable from application faults. Reproduced with a bare `SELECT 1` probe; no application code is implicated.

**Impact**
Medium

**Requires**
Infrastructure

## BACKEND DEFECT — Student Results endpoint returns runtime error for valid student

**Severity:** high · **Layer:** backend · **Raised:** frontend Module 6 verification

`GET /api/results/student/[studentId]` returns a failure envelope for a
student who exists, is ACTIVE, and whose profile, dashboard, attendance,
assignments, transcript and fee endpoints all answer 200.

Reproduce:

```
POST /api/auth/login   { tenantSlug: "demo", email: "student@demo.edu",
                         password: "Student@123" }
GET  /student/results  ->  renders ErrorState
```

The frontend behaviour is CORRECT and must not be changed: the request
fails, so an ErrorState is the right state and the page says the results
service is unavailable rather than that the student has no results. Do not
"fix" this by rendering an empty state — that would report a system fault
as an academic fact, telling a student they have no results when the
system simply could not compute them.

This is a backend defect. It is recorded here rather than worked around.

**Frontend files involved (no change required):**
`app/(portals)/student/results/page.tsx`, `services/evaluation.ts`

**Suggested backend investigation:** `lib/services/result.service.ts`
(1091 lines) and its regulation-preparation path — `composeAcademic` in
`studentProfile.service.ts` already catches a throw from
`getStudentResult` and degrades the dashboard panel to nulls, which
suggests this endpoint can raise for a student whose evaluation scheme is
incomplete.

## BACKEND GAP — endpoints the UI calls that do not exist

**Severity:** medium · **Layer:** backend · **Raised:** QA gate, verified at runtime

Observed live during a 232-request sweep of every route as every role.
Each returns 404 because the route is absent, not because the record is:

| Endpoint | Callers | Consequence today |
|---|---|---|
| `GET /api/certificates` | certificates/templates | certificate list cannot load |
| `GET /api/users/[id]/preferences` | account settings | notification tab cannot load |
| `GET /api/payments` | student fee history | payment history cannot load |

`GET /api/faculty/me` also returns 404 for SUPER_ADMIN and UNIVERSITY_ADMIN.
That one is CORRECT and needs no work: those accounts own no FacultyMember
row, and 404 is the honest answer.

The frontend renders these as unavailable rather than empty, so no screen
claims the records are absent. Do not "fix" this by suppressing the panels.

---

## BACKEND GAP — no collection endpoint accepts a search or filter parameter

**Severity:** medium · **Layer:** backend · **Priority:** high for scale

Verified at runtime, not inferred. `listStudentsQuerySchema`,
`facultyQuerySchema`, `listTenantsQuerySchema` and their siblings extend
`paginationQuerySchema` and add nothing, so Zod drops `?q`, `?status`,
`?departmentId` and the rest before the handler sees them:

```
/api/students?q=zzzzzzzz          3 -> 3    dropped
/api/students?status=WITHDRAWN    3 -> 3    dropped
/api/users?q=zzzzzzzz            11 -> 11   dropped
/api/faculty?departmentId=…       3 -> 3    dropped
/api/campuses?q=zzzzzzzz          2 -> 2    dropped
/api/courses?type=LAB             4 -> 4    dropped
```

Thirty-one controls across twelve screens are consequently rendered
disabled with an explanation. They are not deleted, so the screens keep
their shape and nothing needs redesigning when the parameters land.

NOTE FOR WHOEVER PICKS THIS UP: the evaluation module's filters are NOT in
this list. They ARE implemented — probing with an invalid enum returns 400,
which proves the route parses the value. A row-count comparison had
suggested otherwise only because those tables are empty.

**Suggested fix:** extend each collection's query schema and `where` clause.
No frontend change is required — removing the `unsupported` prop re-enables
each control.

UPDATE (W1.3): `GET /api/platform/users` is the first collection to close this.
`listPlatformUsersQuerySchema` accepts `?q` and the service matches `email`,
`firstName` and `lastName` case-insensitively, so `/platform/users` renders an
ENABLED search box while every other list still renders a disabled one. That
asymmetry is intended and is the pattern the rest should follow, one collection
at a time — it is not an inconsistency to normalise by disabling this one.

---

## WP-2 — Audit & Governance (PRD §47)

### TD-W2-1 — Audit immutability is enforced at the API layer, not the database
**Severity:** Medium
**What:** No POST/PATCH/DELETE handler exists for `/api/audit-logs` (verified: 405). Nothing stops a direct database connection from altering `AuditLog`.
**Why not fixed:** A Postgres rule or a revoked UPDATE grant would be stronger, but Prisma's migration engine does not manage grants and the application connects as the table owner — a trigger would be one `migrate` away from being silently dropped. The absent handler cannot be bypassed by an HTTP client at all, which is the threat this actually defends against.
**Fix:** A dedicated least-privilege application role with `INSERT, SELECT` only on `AuditLog`, granted outside Prisma's migration history.

### TD-W2-2 — Two audit action vocabularies coexist
**Severity:** Low
**What:** Eleven pre-WP-2 modules each declare their own action names in their own constants file. WP-2 adds a shared catalogue in `lib/constants/audit.ts`. The viewer's action filter offers only the WP-2 set, so older entries are reachable only without that filter.
**Why not fixed:** Rewriting action names already written to stored rows would change the meaning of existing evidence — the one thing an audit system must never do.
**Fix:** Migrate the eleven modules' constants to the shared catalogue for *new* writes only, leaving stored rows untouched, and have the filter offer both.

### TD-W2-3 — ~72% of mutations remain unaudited
**Severity:** Medium
**What:** 112 mutating route files; roughly 31 now audited. Unaudited: fee demands and structures (PRD §47 "Fee modification logs"), tenants, campuses, schools, departments, programmes, courses, timetable, attendance, assignments, announcements, notification templates, role create/update/delete, identifier-sequence configuration.
**Why not fixed:** WP-2 prioritised the events PRD §47 names explicitly plus the WP-1 deferral. Wiring 80 more routes in one pass would be a large unreviewable diff.
**Fix:** Wire per module as each is next touched; **fee modification is the highest-priority remaining §47 line.**

### TD-W2-4 — No audit export, and no retention policy
**Severity:** Low
**What:** PRD §47 lists "Audit report exports"; §46.3 lists "Data-retention policies" but names no period for audit records.
**Why not fixed:** Export is unbuilt. Retention was **deliberately not invented** — audit evidence must not disappear on an arbitrary schedule nobody specified.
**Fix:** Export after a product decision on format and on who may perform it (an export is itself an auditable event). Retention needs a stated period from the product owner.

### TD-W2-5 — `UserRole.scope` is recorded but never enforced
**Severity:** Medium
**What:** `UserRole.scope` is a JSON column. WP-2 now records its value in the `ROLE_ASSIGNED` entry, so scope changes are auditable. No authorization path reads it.
**Why not fixed:** Enforcing it is ABAC, and the PRD (§4.3) lists campus/department/programme/batch/record-level permissions without defining precedence, inheritance or conflict resolution. Implementing it on a guess would produce an access-control model nobody specified.
**Fix:** Its own work package, after the product owner defines the scope-resolution rules. **RBAC is not ABAC and this build does not claim to be.**

### TD-W2-6 — Domain, branding and subscription changes are unaudited
**Severity:** Low — recorded for WP-3
**What:** `Domain` and the `Tenant` branding columns have no write path at all yet, so there is nothing to audit. `/api/platform/*` (tenant and subscription mutations) does have write paths and is unaudited.
**Fix:** WP-3 must audit domain and branding writes as it creates them, rather than adding audit afterwards.

---

## WP-3 — Tenant Domains + Branding (PRD §5.2, §45)

### TD-W3-1 — Automated DNS verification is not implemented
**Severity:** High — blocks self-service custom-domain onboarding
**What:** PRD §5.2 requires it. The `verified` flag exists, is honoured (an unverified domain does not resolve) and is set by a platform operator. The verification protocol is not built.
**Why not fixed:** The PRD names no record type, token format, schedule, or behaviour when a verified domain later stops resolving. Implementing a guess would mean publishing DNS instructions to universities that may be wrong, and a protocol to migrate away from. Recorded as an explicit pending requirement at the product owner's direction.
**Fix:** Decide (a) TXT or CNAME, (b) token format and lifetime — needs a new column, (c) who triggers the check: this stack has no worker, so admin-initiated is the only option without new infrastructure, (d) what happens to traffic when a previously verified domain stops resolving.

### TD-W3-2 — SSL, expiry reminders, redirects, custom email domain
**Severity:** Medium
**What:** PRD §5.2 lists all four. None built.
**Why not fixed:** SSL provisioning needs ACME plus a hosting platform that will accept dynamic certificates; expiry reminders need a registrar API; email domain needs a mail layer. None exists.
**Fix:** Deployment-platform decision first — the answer differs entirely between Vercel, a load balancer and self-hosted.

### TD-W3-3 — Branding covers 4 of ~22 §45 fields
**Severity:** Low
**What:** Logo, favicon, primary and accent colour work end to end. Typography, portal layout, login-screen layout, splash screen, SMS sender ID, email sender/domain, mobile app name and icon, document/ID-card templates, language, timezone, currency, date format and academic terminology are not configurable.
**Why not fixed:** None has a column, and adding ~18 the MVP cannot consume would be invented scope.
**Fix:** Add per field as the consuming feature is built, not in advance.

### TD-W3-4 — Only two brand colours reach the design system
**Severity:** Low — deliberate
**What:** `--brand-primary` and `--brand-accent`. The 40 generated palette steps are untouched.
**Why:** Letting a tenant set arbitrary steps allows unreadable combinations — white on white, a "success" state in red. Two accents over an intact system keeps every screen legible whatever a university chooses.
**Fix:** None needed unless a customer demands deeper theming, which should then derive a full ramp from the brand colour rather than exposing 40 fields.

### TD-W3-5 — Logo/favicon are URLs, not managed uploads
**Severity:** Low
**What:** Validated to https or same-origin. No upload pipeline, no size or content-type check, no proxying.
**Why not fixed:** No media pipeline exists, and the brief said not to add a storage provider unnecessarily. The browser fetches these directly — the server never does, so there is no SSRF surface today.
**Fix:** If a server-side fetch is ever added (thumbnailing, proxying), it needs its own allow-list. `isSafeAssetUrl`'s doc comment records this.

### TD-W3-6 — `www.` is not treated as canonical
**Severity:** Low
**What:** `www.university.edu` and `university.edu` are separate hostnames; each needs its own Domain row.
**Why:** Whether they are the same institution is a configuration decision (§5.2 "Canonical domain configuration"), not a parsing one. Collapsing them in `normaliseHost` would silently resolve a hostname nobody registered.
**Fix:** If desired, an explicit "also accept www" toggle per domain — not a parsing rule.

### TD-W3-7 — Node `fetch` cannot set a Host header (testing note)
**Severity:** Informational
**What:** `Host` is a forbidden header name in undici, so `fetch` silently drops it. A probe using it produced false 200s that briefly looked like a tenant-isolation failure.
**Fix:** Use `curl -H "Host: …"` for any host-dependent test. Recorded so the next person does not repeat it.

---

## W1.3 — Platform Users

### TD-W13-1 — Platform user changes are not written to `AuditLog`
**Severity:** Medium — the events are recorded, but not queryably
**What:** Creating, updating, activating, deactivating and password-resetting a
platform operator are logged with `console.warn` (`[platform-users] …`, actor id
+ subject id + verb) rather than to `AuditLog`. Platform authentication already
does the same for the same reason.
**Why not fixed:** `AuditLog.tenantId` is required and foreign-keyed to `Tenant`,
so a platform event has nowhere of its own to live. Writing it against an
arbitrary tenant would file platform activity inside a university's readable
audit trail — worse than not recording it, because that university could read
who operates the platform.
**Fix:** Make `AuditLog.tenantId` nullable and add a platform-scoped read path.
That is a change to a table eleven modules already write to, so it belongs in
its own reviewed work package rather than being smuggled in beside a user list.

### TD-W13-2 — A temporary password is handed over in-band
**Severity:** Medium
**What:** `POST /api/platform/users` and `POST /api/platform/users/[id]/reset-password`
return the generated plaintext once, in the response body, to the authenticated
`PLATFORM_ADMIN` who made the call. The creating operator therefore knows the
new operator's first password.
**Why not fixed:** There is no mail transport anywhere in this codebase. The
alternative is a token-and-link flow needing a new table, an expiry sweep and a
delivery channel that does not exist — which is the invitation system W1.3
explicitly says not to invent. The exposure is bounded: only the hash is stored,
`mustChangePassword` is set, and `requirePlatformAdmin` refuses every request
from that account until its owner replaces the password, so the shared secret
buys exactly one sign-in.
**Fix:** Once a mail layer exists, send a single-use setup link instead and stop
returning the plaintext. The `mustChangePassword` column and the
`/super-admin/change-password` route are reused unchanged by that flow.

### TD-W13-3 — Platform sessions are not revoked on deactivation or reset
**Severity:** Low
**What:** Deactivating an operator or resetting their password does not
invalidate an already-issued platform JWT; the token stays syntactically valid
until it expires.
**Why not fixed:** It does not need to be. `requirePlatformAdmin` re-reads
`isActive` and `mustChangePassword` from the database on every request, so the
token grants nothing from the next request onward — and the platform token's TTL
is one hour. A revocation list would add state to a stateless session for a
window the guard already closes.
**Fix:** Only if platform tokens are ever given a long lifetime, in which case a
`tokenVersion` column on `PlatformUser` compared in the guard is the cheap
option.

---

## W1.4 — University Provisioning

### TD-W14-1 — Provisioning events are not written to `AuditLog`
**Severity:** Medium
**What:** Creating a university, provisioning its first administrator and changing
its status are logged with `console.warn` (`[provisioning] …`, actor id + tenant
id + subject id) rather than to `AuditLog`.
**Why not fixed:** This is a closer call than TD-W13-1, because a tenant DOES
exist and `AuditLog.tenantId` could be satisfied. It is still declined:
`AuditLog` is the university's own trail, readable by that university's admins
through `/governance/audit`, and "the platform created your administrator
account" is a platform act about a tenant rather than a tenant act. Filing it
there would also expose platform-operator ids in the actor column to the tenant.
**Fix:** The same fix as TD-W13-1 — a platform-scoped audit path, which needs
`AuditLog.tenantId` to become nullable. W1.4's instruction not to build
platform-wide audit access is consistent with deferring it.

### TD-W14-2 — The forced-change redirect covers the university portal only
**Severity:** Low
**What:** `mustChangePassword` is enforced for EVERY tenant API by `requireAuth`,
which is the control. The convenience redirect that sends a user to
`/change-password` instead of a console full of 403s exists in the login form and
in `app/(university)/layout.tsx`, but not in the faculty, student or account
layouts.
**Why not fixed:** W1.4 provisions exactly one kind of account — a
UNIVERSITY_ADMIN — and no W1.4 path sets the flag on a faculty member, student or
parent. Adding the read to three more layouts today would be three more
per-navigation queries guarding a state nothing can currently produce.
**Fix:** When bulk user import (W1.6) starts issuing generated passwords to
faculty and students, lift the check into a shared portal guard rather than
copying it into each layout.

### TD-W14-3 — No email delivery for provisioned credentials
**Severity:** Medium — same root cause as TD-W13-2
**What:** The initial University Admin's password is returned once in the
provisioning response and handed over out of band by the platform operator.
**Why not fixed:** There is no mail transport in this codebase. The exposure is
bounded: only the bcrypt hash is stored, `mustChangePassword` is set, and
`requireAuth` refuses every tenant API until the owner replaces it — so the
credential buys exactly one sign-in.
**Fix:** Once a mail layer exists, send a single-use setup link instead. The
`User.mustChangePassword` column and `POST /api/auth/change-password` are reused
unchanged by that flow.

### TD-W14-4 — Provisioning does not create a `Domain` row
**Severity:** None — recorded so the absence is not read as an oversight
**What:** A provisioned university reaches its console at
`<slug>.<root-domain>` through the platform-subdomain path in
`lib/services/tenant.ts`, which needs no `Domain` row. None is written.
**Why:** `Domain` is for a CUSTOM hostname an institution proves it controls, and
an unverified row does not resolve. Writing one at provisioning time would put a
non-functioning domain on the tenant's domains screen that nobody asked for. The
existing `/platform/tenants/[id]/domains` screen is the intended path.

---

## W2 — Parent Portal (PRD §32)

### TD-W2-1 — Online payments not built
**Severity:** Medium
**What:** §32 names "Online payments" and §23.2 "Parent payment portal". The
parent fee screen is READ ONLY and offers no payment control.
**Why not built:** no gateway, provider, reconciliation, refund or
failed-payment behaviour is defined anywhere in the PRD. A "Pay now" button
would be a control with nothing behind it, and money is the worst place to guess.
**Fix:** needs a payment-provider decision, then §23.2's flows.

### TD-W2-2 — Notification preferences have no model or route
**Severity:** Medium
**What:** §32 names "Notification preferences" and it is NOT implemented.
`services/account.ts` posts to `/api/account/notification-preferences`, which
does not exist, and its own comment records why: "NO BACKEND ROUTE OR TABLE
EXISTS — schema.prisma declares no UserPreference". `Notification` stores sent
messages, not preferences.
**Why not built:** inventing a `UserPreference` model and a channel/category
matrix would be inventing the requirement. §33 lists channels for SENDING, not a
per-user preference schema.
**Fix:** a defined preference model — which channels, which categories, what
defaults — then one route serving both the account screen and the parent portal.

### TD-W2-3 — Seven §32 features have no module to expose
**Severity:** Low — scope boundary, recorded so the omission is explicit
**What:** Faculty communication, behavioural reports, leave requests, counsellor
appointments, hostel details, transport tracking, upcoming events and raising
concerns are all absent from the parent portal.
**Why:** none has a Prisma model. §27 (hostel), §28 (transport), §34 (events) and
§35 (grievance) are unbuilt modules; faculty messaging, behavioural reports,
leave requests and counsellor appointments have no defined workflow anywhere in
the PRD. Nothing was stubbed — PARENT_NAV offers only screens with a backing API,
and a test asserts it.

### TD-W2-4 — Parent contact records and parent accounts are now two things
**Severity:** Low
**What:** `Parent.userId` is nullable, so a Parent row may be a pure CONTACT
record (as every existing row is) or a contact record WITH a sign-in account.
Nothing prompts an administrator to create accounts, and `POST /api/parents`
still creates contacts only.
**Why it is this way:** requiring an account would have invalidated every
existing guardian record. Account creation is a separate, explicit act:
`POST /api/parents/[id]/account`.
**Fix:** if universities expect every guardian to have portal access, the
students UI needs a visible "create parent account" affordance. Deliberately not
added — no PRD requirement describes it.

---

## W1.6 — Initial University Data Import (PRD §5.1 #14, §54, §55)

### TD-W16-1 — RESOLVED: credential policy approved and implemented
**Severity:** was High · now closed
**What was blocking:** Student, Faculty and Employee import each creates a
`User`, and `User.passwordHash` is NOT NULL, but the PRD defines no credential
mechanism for imported people.
**Resolution (approved decision, not an assumption):** the W1.4 mechanism reused
unchanged — a cryptographically generated temporary password per person, only
the bcrypt hash stored, `mustChangePassword = true`, and the plaintext returned
ONCE in the commit response for a one-time credentials CSV download. A
`password` column in the source file is rejected with 400. No email/SMS
delivery and no admin reset endpoint were added, as directed.
**Verified live:** 4 imported users all carry `$2b$12$` hashes and
`mustChangePassword=true`; the preview returns no credentials; the plaintext
appears nowhere in the server log.

### TD-W16-4 — RESOLVED: role assignment on person import
**Severity:** was Medium · now closed for Student and Faculty
**Resolution:** the import grants an EXISTING tenant role inside the same
transaction as the User and profile, using the existing `UserRole`/`Role`
architecture unchanged. Student → `STUDENT`, Faculty → `FACULTY`. The role name
is a constant in the entity catalogue, never a CSV column, and is resolved by
name within the tenant — the identifier `requireRole` itself compares on.
**Import never creates a Role.** PRD §55 puts "Roles" in Stage 2 Configuration
and data import in Stage 3, so a role is expected to exist by the time a file
arrives. A missing role is a file-level refusal naming the role and how to fix
it, at preview as well as commit, so an operator learns before committing.
**Verified live:** a tenant with FACULTY but no STUDENT role imported faculty
successfully and refused students with a clear message and zero writes; after
the university created the STUDENT role the same file imported and the account
carried `roles=[STUDENT]`; re-import added no second grant (UserRole is
`@@id([userId, roleId])`, so a duplicate is impossible by construction); no
grant ever referenced another tenant's role.

### TD-W16-6 — FINDING: the product defines no employee role or employee portal
**Severity:** Medium — a product gap, not an implementation gap
**What:** Imported Employees receive NO role, deliberately. The role names the
API enforces are `SUPER_ADMIN`, `UNIVERSITY_ADMIN`, `FACULTY` and `STUDENT`; the
wider vocabulary adds `CAMPUS_ADMIN`, `HOD`, `DEPARTMENT_HOD`,
`CONTROLLER_OF_EXAMINATION` and `PARENT`. **None describes a non-teaching
employee**, `homeRouteForRoles` routes none of them to an employee portal, and
no employee portal exists — PRD §57 lists "Employees" as a screen the
ADMINISTRATOR uses, not a portal an employee signs into.
**Why nothing was invented:** creating a `STAFF`/`EMPLOYEE` role would add a name
no guard compares against — it would grant nothing while appearing to grant
something. Granting one of the existing roles would hand a clerk a portal they
have no business in.
**Consequence:** an imported Employee is a managed record with a sign-in account
that reaches `NO_PORTAL_ROUTE`. The import UI states this before the operator
runs it.
**Fix:** a product decision on whether employees are portal users at all. If
they are, it needs a role AND a portal, which is its own work package.

### TD-W16-5 — Person imports are capped at 200 rows by bcrypt cost
**Severity:** Low — measured, not guessed
**What:** `MAX_PERSON_IMPORT_ROWS` is 200 against 2000 for non-person entities.
bcrypt at the project's cost factor measures ~520ms per hash on this hardware,
so 200 people is ~105 seconds of hashing; 2000 would be ~17 minutes and would
time out. Hashing runs BEFORE the transaction opens, so no database locks are
held during it, and the interactive-transaction timeout is raised to 120s
because identifier issuance is one locked round trip per row that needs a number.
**Fix:** a background job, or a lower cost factor for imported accounts (which
would weaken them). Neither is warranted until a real migration exceeds 200 rows
per file; the error message tells the operator to split the file.

### TD-W16-2 — Programme import needs departments, which no platform route creates
**Severity:** Medium
**What:** `Programme.departmentId` is NOT NULL, so programme import requires
departments to exist. W1.5 added platform-scoped routes for campuses, academic
years and branding, but not for departments — and `/api/departments` is
tenant-guarded, so a platform operator cannot create one. A freshly provisioned
university therefore cannot receive a programme import until its own
administrator creates departments first.
**Why not fixed here:** adding a platform departments route is W1.5 surface, and
W1.6's instruction was not to modify unrelated modules. Course import is
unaffected — `Course.departmentId` is nullable.
**Fix:** a platform-scoped departments route mirroring the W1.5 campuses one.

### TD-W16-3 — Five §54 migration modules remain unimplemented
**Severity:** Low — scope, recorded so the boundary is explicit
**What:** §54 names ten migration modules. W1.6 was scoped to the foundational
five and delivered all five: Course, Programme, Student, Faculty, Employee.
Of the remainder: Fee balances, Attendance history,
Examination history and Certificates have models but depend on data a newly
onboarded tenant has none of (FeeStructure, Sections, Examinations,
CertificateTemplate). **Library records, Alumni records and Financial opening
balances have NO Prisma model at all** and cannot be built without inventing
one.

---

## W1.5 — University Onboarding (PRD §5.1, §49.1)

### TD-W15-0 — DEFECT FOUND AND FIXED: ARCHIVED bypassed both access gates
**Severity:** was Critical · now fixed
**What:** W1.5 added `TenantStatus.ARCHIVED`. Tenant resolution
(`lib/services/tenant.ts`) and the tenant login route both decided servability
with a DENY-list — `status === "CANCELLED" || status === "SUSPENDED"` — so
ARCHIVED fell through both. An archived university went on resolving its
hostname and issuing sessions: the exact opposite of archiving.
**How it was found:** live verification, not review. The unit tests and the type
checker were both perfectly happy.
**Fix:** one shared ALLOW-list, `lib/domain/tenant/servable.ts` — only ACTIVE
and TRIAL may serve — used by both call sites. `lib/domain/tenant/servable.test.ts`
asserts exhaustiveness, so adding a status to the enum now fails a test until a
servability decision is recorded for it.
**Lesson recorded:** a deny-list over an enum that can grow is how this happened.
Any future "which statuses may X" check should be stated positively.

### TD-W15-1 (GAP-01) — Module catalogue RESOLVED; enforcement remains open
**Severity:** Medium — selection is now constrained and honest; nothing reads it
**RESOLVED PART:** The catalogue is PRD §57's University Administration
navigation, transcribed verbatim into `lib/constants/modules.ts` (23 entries,
each citing its PRD section). `PUT /api/platform/tenants/[id]/modules` accepts
only those keys, so `{"jhjj": true}` is now a 400 rather than a stored module.
Unrecognised keys already in the column are preserved and surfaced in the UI
rather than deleted or promoted. §2.1 "Module allocation" and §57's Super Admin
"Modules" entry confirm the capability belongs to the platform operator.
**STILL OPEN:** nothing in the product READS the selection. The PRD names module
allocation in §2.1, §5.1 and §57 and nowhere states what a disabled module does —
no hidden navigation, no 403, no 404, no redirect — so no enforcement was
invented. The UI says this plainly rather than implying the switches act.
**Fix:** needs a PRD statement of disabled-module behaviour.

**Original finding, retained for history:**
**What:** PRD §5.1 says "Assign enabled modules" and defines no module list, no
keys, no defaults and no disabled-module semantics. `Subscription.features` is an
untyped JSON column that accepts any key; `/platform/feature-flags` persists into
it (verified live), and **nothing in the codebase reads it to gate anything**. A
grep for `.features` finds only the flag screen itself.
**Why not fixed:** Inventing a catalogue would define an authorization model the
PRD does not describe. Confirmed as GAP-01 by the product owner.
**Evidence of the cost:** the column currently holds hand-typed junk (`{"jhjj":
true}`) because nothing can reject an unknown key.
**Fix:** Needs the PRD's module list. Then: an enum or constant catalogue, a
guard that refuses a disabled module, and validation on the column.
**W1.5 behaviour:** the readiness checklist reports only whether a selection has
been RECORDED. It cannot and does not claim the right modules were chosen.

### TD-W15-2 (GAP-02) — Pricing basis RESOLVED; payment TERMS remain undefined
**Severity:** Low
**RESOLVED PART:** §5.3 does define billing concepts, and those are now
implemented: `Subscription.pricingModel` (`FLAT_PLAN`, `MODULE_BASED`,
`PER_STUDENT`, `PER_ACTIVE_USER`, `PER_COURSE`, `STORAGE_BASED` — §5.3's own
list) and `Subscription.autoRenew` (§5.3 "Auto-renewal management"), alongside
the existing `billingCycle` (§5.3 "Annual and monthly billing").
**STILL OPEN:** "payment terms" as a distinct concept. §5.1 names it; no section
defines a due day, net period, advance payment or grace. The update schema
REJECTS such fields, and a test asserts it does, so nobody can add
`paymentTerms: "NET_30"` by accident.

### TD-W15-3 (GAP-03) — Archival RESOLVED non-destructively; deletion NOT built
**Severity:** Low
**RESOLVED PART:** `TenantStatus.ARCHIVED` plus `Tenant.archivedAt` /
`archivedBy`, and `POST /api/platform/tenants/[id]/archive` with a restore
direction. Archiving keeps every row and takes the university offline through
the same allow-list that already blocks SUSPENDED and CANCELLED; restore returns
it to SUSPENDED, not ACTIVE, so bringing an institution back is deliberate. The
UI requires the university's name to be typed.
**STILL OPEN, DELIBERATELY:** no hard delete. §46.3 names "Data-retention
policies" and "Data-deletion workflows" without defining either, and §54's
"Legacy Archival" is a DATA MIGRATION step. Retention period, export format and
restore window are all undefined, so the destructive half is not built. The
archive schema REJECTS `retentionDays`, `purgeAt`, `hardDelete` and
`exportFormat`, with a test asserting it.

**Original finding, retained for history:**
**What:** §5.1 says "Tenant deletion and data archival". Deleting a `Tenant`
cascades its users, roles, campuses, subscriptions and records away. §54 names
"Legacy Archival" as a step in the DATA MIGRATION process, not as a tenant
deletion format, and no retention or restore semantics are defined anywhere.
**Why not fixed:** Confirmed as GAP-03. **No tenant-deletion endpoint was built**
— shipping deletion without the archival half would be the destructive half of a
requirement on its own. Deactivation (`SUSPENDED`/`CANCELLED`) covers the
reversible need and is fully implemented.

### TD-W15-4 — "Upload university logo" links a URL; there is no file storage
**Severity:** Low
**What:** §5.1 says "Upload university logo and branding". The Tenant branding
columns are and always were URLs, and this project has no object storage and no
upload endpoint anywhere.
**Why not fixed:** A file picker with no storage behind it is a fake control. The
branding panel says plainly that images are linked, not uploaded.
**Fix:** Object storage plus an upload route; the columns need no change.

### TD-W15-5 — Two guarded paths now write Campus, School, AcademicYear and branding
**Severity:** Low — intentional, recorded so it is not read as duplication
**What:** `/api/campuses`, `/api/academic-years` and `/api/tenant/branding` are
tenant-guarded (`requireRole` + `requireTenant`). W1.5 adds
`/api/platform/tenants/[id]/{campuses,academic-years,branding}` behind
`requirePlatformAdmin()`.
**Why:** §5.1 places this configuration in the Super Admin panel, and a platform
operator can never satisfy `requireTenant` — they hold no tenant session and call
from the root domain. Same models, same rows, different actor. Neither path is
authoritative.
**Fix:** None required. If the two ever diverge in validation, extract the shared
Zod shape rather than merging the guards.

### TD-W15-6 — Onboarding progress is not written to `AuditLog`
**Severity:** Low — same root cause as TD-W13-1 and TD-W14-1
**What:** Stage sign-offs and platform-side configuration are logged with
`console.warn` (`[provisioning] …`). `TenantOnboardingStep` does record
`completedBy` and `completedAt` durably, so the sign-off itself is not lost.

---

## W1.1 AUDIT — CRITICAL: privilege escalation from University Admin to Platform Admin

### TD-W1-1 — A university admin can grant themselves SUPER_ADMIN
**Severity:** CRITICAL — cross-tenant platform compromise
**Status:** Found by live test, probe reverted, **NOT YET FIXED**

**Reproduction (verified against the running application):**
1. Sign in as `admin@demo.edu` (UNIVERSITY_ADMIN of the `demo` tenant).
2. `GET /api/roles` — the `demo` tenant contains a role named `SUPER_ADMIN`
   (id `cms8o8khc0001…`), because the seeded platform operator
   `superadmin@eduos.local` is itself a user of the `demo` tenant.
3. `POST /api/users/{self}/roles` with that roleId → **201 Created**. The route
   is guarded by `requireRole("UNIVERSITY_ADMIN")`, which the caller satisfies.
4. Re-authenticate. The new JWT carries `roles: ["UNIVERSITY_ADMIN","SUPER_ADMIN"]`.
5. `GET /api/platform/tenants` → **200, all 5 tenants on the platform**.

**Root cause — three facts that are individually reasonable and jointly fatal:**
1. `User.tenantId` is REQUIRED, so the platform operator had to be placed inside
   some tenant. The seed puts them in `demo`.
2. `Role` is `@@unique([tenantId, name])` — role names are per-tenant, so
   `SUPER_ADMIN` is an ordinary tenant-scoped row that a tenant admin can see
   and assign.
3. `requireRole` compares role NAMES from the JWT
   (`assignedRoleNames.some((n) => roles.includes(n))`). It cannot distinguish
   "SUPER_ADMIN granted by the platform" from "SUPER_ADMIN granted inside a
   tenant", because at that point they are the same string.

Platform authority is therefore expressed as a string inside a tenant's own
data, and tenants can write their own data.

**Why the obvious patches are insufficient:**
- Blocking assignment of a role named `SUPER_ADMIN` — a deny-list on a
  user-suppliable string. It also does nothing about the other four tenants,
  each of which may create its own `SUPER_ADMIN` role and assign it freely.
- `isSystem` on Role — the flag exists but nothing reads it, and it still leaves
  platform authority inside tenant-owned rows.

**The correct fix is the architecture already specified for W1.2:** a platform
identity separate from tenant users, with its own session and its own guard
(`requirePlatformAdmin()`), so platform authority is never a value a tenant can
write. `requireRole("SUPER_ADMIN")` must then be removed from every platform
route rather than reinterpreted.

**Interim containment for any deployment before W1.2 ships:**
Ensure no tenant contains a role named `SUPER_ADMIN` other than the one held by
the platform operator, and treat `POST /api/users/[id]/roles` as a
platform-privileged operation. Neither is a fix; both reduce exposure.
