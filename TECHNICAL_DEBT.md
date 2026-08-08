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
