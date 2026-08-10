# eduOS — PRD Completion Matrix

**Source of truth:** *Multi-University Management, E-Learning and Certification Platform* (PRD, 64 pp, §1–§58).
**Repository state audited at:** commit `9ebc1d1` (merge of Phase 21–27) plus the Notification Centre work in the working tree.
**Audit method:** every status below is derived from reading the actual file, the actual Prisma model, or a live HTTP probe against the running build. Nothing is inferred from a route name.

## How to read a status

| Status | Means |
|---|---|
| `NOT_STARTED` | No model, no API, no page. |
| `DISCOVERED` | A database model or column exists, but nothing reads or writes it through an API or UI. |
| `IN_PROGRESS` | Partially built; named gaps below. |
| `BACKEND_COMPLETE` | Model + API + guard verified, no UI. |
| `FRONTEND_COMPLETE` | UI exists but is not fully wired or verified. |
| `INTEGRATION_COMPLETE` | DB → API → guard → UI all wired. |
| `TESTING` | Wired, tests being written. |
| `BLOCKED` | Cannot proceed; blocker named. |
| `COMPLETE` | Every layer verified **against the running application**. |

`COMPLETE` is never claimed from reading code.

## Measured baseline

| Metric | Count |
|---|---|
| Prisma models | 73 |
| Prisma enums | 65 |
| Models carrying `tenantId` | 59 / 73 |
| API route files | 164 |
| Frontend pages | 71 |
| Roles defined in `constants/roles.ts` | 9 |
| Roles named by the PRD (§4.1 + §4.2) | ~50 |
| Tests | 2016 passing |

---

## Part A — Platform (PRD §2, §5, §45, §46, §47, §48)

| ID | PRD Requirement | § | Module | Backend | API | DB | Frontend | Permission | Tenant Isolation | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P-01 | Multi-tenant architecture (shared DB, tenant rows) | 48.2 | Platform | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **COMPLETE** |
| P-02 | Central Super Admin panel | 5 | Platform | Yes | Yes | Yes | Partial | Yes | Yes | Yes | IN_PROGRESS |
| P-03 | University onboarding workflow (enquiry→go-live, 10 stages) | 5.1, 49.1 | Platform | No | No | Partial | No | — | — | No | NOT_STARTED |
| P-04 | Tenant activate / deactivate / suspend | 5.1 | Platform | Yes | Yes | Yes | Yes | Yes | Yes | Yes | INTEGRATION_COMPLETE |
| P-05 | Tenant deletion and data archival | 5.1 | Platform | No | No | No | No | — | — | No | NOT_STARTED |
| P-06 | Onboarding progress / readiness checklist | 5.1 | Platform | No | No | No | No | — | — | No | NOT_STARTED |
| P-07 | **Custom domain mapping** | 5.2 | Platform | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **COMPLETE** — live-verified by Host header |
| P-08 | Platform subdomain routing (`slug.platform.com`) | 5.2 | Platform | Yes | Yes | Yes | n/a | Yes | Yes | Yes | COMPLETE |
| P-09 | Domain-based login routing | 5.2 | Platform | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **COMPLETE** — a host resolves its tenant before auth |
| P-10 | DNS verification | 5.2 | Platform | No | Flag only | Yes | Flag only | Yes | Yes | No | ⏳ **DEFERRED — PRD names no mechanism** (see below) |
| P-10b | SSL provisioning / expiry reminders / redirects / email domain | 5.2 | Platform | No | No | No | No | — | — | No | ⏳ DEFERRED — needs ACME + registrar + mail infrastructure |
| P-11 | Learning / admissions / verify sub-domains | 5.2 | Platform | No | No | Partial | No | — | — | No | NOT_STARTED |
| P-12 | White-label branding — logo, favicon, brand colours | 45 | University | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **COMPLETE** |
| P-12b | Branding — typography, portal layout, splash, SMS/email sender, app name | 45 | University | No | No | No | No | — | — | No | ⏳ DEFERRED — no columns; adding 6 the MVP cannot consume is invented scope |
| P-13 | Subscription plans and limits | 5.3 | Platform | Yes | Yes | Yes | Yes | Yes | Yes | Yes | INTEGRATION_COMPLETE |
| P-14 | Module-based / per-student / per-course pricing | 5.3 | Platform | No | No | Partial | No | — | — | No | NOT_STARTED |
| P-15 | Invoicing, credit notes, GST, coupons, ledger | 5.3 | Platform | Partial | No | Partial | No | — | — | No | DISCOVERED |
| P-16 | Platform-wide monitoring (19 metrics) | 5.4 | Platform | Partial | Partial | Partial | Partial | Yes | Yes | Partial | IN_PROGRESS |
| P-17 | Global configuration masters (17 master types) | 5.5 | Platform | No | No | No | No | — | — | No | NOT_STARTED |
| P-18 | Feature flags / module enable-disable | 5.1 | Platform | Yes | Yes | Yes | Yes | Yes | Yes | Yes | INTEGRATION_COMPLETE |
| P-19 | **Audit log surface** (read/report/export) | 47 | Platform | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **INTEGRATION_COMPLETE** — read + viewer; export NOT_STARTED |
| P-20 | Immutable critical-action records | 47 | Platform | Yes | Yes | Yes | n/a | Yes | Yes | Yes | **COMPLETE at the API layer** — no write/edit/delete endpoint exists (405 verified); DB-level grants NOT enforced |

### WP-2 — Audit & Governance (PRD §47)

| §47 requirement | Before WP-2 | After WP-2 |
|---|---|---|
| Login logs | ❌ | ✅ success + failure, live-verified |
| Failed action logs | ❌ unrepresentable — no status column | ✅ `AuditStatus` enum |
| Role modification logs | ❌ | ✅ role assignment |
| Certificate generation logs | ❌ | ✅ |
| Data change logs | ⚠️ 21% of mutations | ⚠️ ~28% — student/faculty/employee identity added |
| Result modification logs | ✅ (pre-existing) | ✅ |
| Any way to READ the trail | ❌ none | ✅ API + viewer, tenant-scoped |
| Immutable critical-action records | ❌ | ✅ at the API layer |
| Export / download / API / impersonation logs | ❌ | ❌ NOT_STARTED |
| Audit report exports | ❌ | ❌ NOT_STARTED |
| Retention policy | ❌ | ⚠️ **deliberately not invented** — PRD §46.3 names no period |

**Identifier generation audit (PRD §9.3)** — deferred by WP-1, delivered here. `IDENTIFIER_ISSUED` is written with the same client that issued the number, so a rolled-back entity creation takes the evidence with it. Live-verified: `{"identifierType":"STUDENT","identifier":"AUD-202600001","sequence":1,"scopeKey":""}`.

**Live security matrix.** ANON→401 · STUDENT/FACULTY/HOD/COE/**SUPER_ADMIN**→403 · UNIVERSITY_ADMIN→200. POST/PATCH/DELETE→**405** (no handler exists). Foreign/unknown detail id→404. Unknown query param→400. Inverted date range→400. `FAILURE(1) + SUCCESS(12) = total(13)` — the status filter genuinely partitions.

**Credential safety, live-verified.** A failed login with password `StillWrong@999` produced `after = {"email":"admin@demo.edu","reason":"incorrect password"}`. The password appears nowhere in the entry.

**SUPER_ADMIN is refused deliberately.** PRD §47 lists the audit trail among a *university's* governance records and §2.2 separates tenant data. Nothing in the PRD grants the platform owner read access to a university's audit trail, and it is the most sensitive collection in the product. **Open question for the product owner** rather than a guess.

### WP-3 evidence (verified against the running application)

Resolution order: **configured Domain (verified + active) → platform subdomain → root host + session.** The pre-WP-3 signature `getTenantFromRequest()` is preserved, so every existing guard works unchanged.

| Host header | Title | Brand colour | Favicon |
|---|---|---|---|
| `aktu.test` | AKTU Test University | `#1A73E8` | AKTU |
| `ipu.test` | IPU Test University | `#E8710A` | IPU |
| `aktu.test` **again, after IPU** | AKTU Test University | `#1A73E8` | AKTU |
| `unverified.test` | eduOS | none | none |
| `stopped.test` (isActive=false) | eduOS | none | none |
| `unknown.test` | eduOS | none | none |

The interleaved A→B→A row is the **cache-isolation proof**: no tenant's branding or metadata bleeds into another's request. `generateMetadata` reads `headers()`, which opts this segment into dynamic rendering — caching is not disabled anywhere.

**Tenant isolation, tested with curl** (Node's `fetch` silently drops a manual `Host` header — an earlier probe using it produced false 200s):

| demo-tenant admin at | Result |
|---|---|
| `localhost:3000` (own) | 200 |
| `aktu.test` | **403 FORBIDDEN** |
| `ipu.test` | **403 FORBIDDEN** |
| `unverified.test` | 404 |
| `unknown.test` | 404 |

**Authorization split, live-verified.** Branding (`/api/tenant/branding`): ANON 401 · STUDENT/FACULTY/HOD/**SUPER_ADMIN** 403 · UNIVERSITY_ADMIN 200. Domains (`/api/platform/tenants/[id]/domains`): UNIVERSITY_ADMIN/HOD/STUDENT 403 · SUPER_ADMIN 200. The two guards are mutually exclusive by design — §45 gives branding to each university, §2.1 gives domain configuration to the platform owner, and a hostname is globally unique so one tenant claiming it denies every other.

### ⏳ DNS verification — an explicit pending requirement

PRD §5.2 requires "Automated DNS verification" and specifies **no mechanism**: no record type (TXT or CNAME), no token format, no schedule, no behaviour when a verified domain stops resolving. The schema offers only `verified: Boolean`.

**What is built:** the flag is real and load-bearing — an unverified domain does not resolve — and an operator sets it. The admin screen states this plainly rather than offering a "Verify now" button that does nothing.

**What is not:** the protocol. Whichever mechanism is chosen needs no schema change.

**P-19 evidence.** `model AuditLog` exists and **is written** — 30 service files reference `auditLog`. There is no read API and no page, so the data accumulates unreadable.

## Part B — Identity, Roles and Security (PRD §4, §46)

| ID | PRD Requirement | § | Backend | API | DB | Frontend | Status |
|---|---|---|---|---|---|---|---|
| S-01 | Email + password authentication | 46.1 | Yes | Yes | Yes | Yes | **COMPLETE** |
| S-02 | Session management (JWT + httpOnly, refresh) | 46.1 | Yes | Yes | Yes | Yes | **COMPLETE** |
| S-03 | RBAC | 4.3 | Yes | Yes | Yes | Yes | **COMPLETE** |
| S-04 | Tenant-level data isolation | 46.2 | Yes | Yes | Yes | Yes | **COMPLETE** — probed with real foreign-tenant ids |
| S-05 | The ~50 PRD roles (Chancellor, Registrar, Dean, Librarian, Warden…) | 4.1, 4.2 | 9 of ~50 | — | Yes | Partial | IN_PROGRESS |
| S-06 | Custom roles per university / role cloning | 4.3 | Partial | Yes | Yes | Partial | IN_PROGRESS |
| S-07 | Attribute-based access control | 4.3 | No | No | No | No | NOT_STARTED |
| S-08 | Campus / department / programme / batch-scoped permissions | 4.3 | Partial | No | Partial | No | DISCOVERED — `UserRole.scope` exists, unused |
| S-09 | Record-level permissions | 4.3 | Partial | Partial | No | No | IN_PROGRESS |
| S-10 | Temporary roles, permission expiry | 4.3 | No | No | No | No | NOT_STARTED |
| S-11 | Delegated approvals, maker-checker, approval matrices | 4.3 | No | No | No | No | NOT_STARTED |
| S-12 | IP / device / login-time restrictions | 4.3 | No | No | No | No | NOT_STARTED |
| S-13 | Download / print / export restrictions | 4.3 | No | No | No | No | NOT_STARTED |
| S-14 | Data masking for sensitive fields | 4.3, 46.3 | No | No | No | No | NOT_STARTED |
| S-15 | Mobile OTP / email OTP / passwordless | 46.1 | No | No | No | No | NOT_STARTED |
| S-16 | SSO (SAML, OAuth, LDAP, Google, M365) | 44.4, 46.1 | No | No | No | No | NOT_STARTED |
| S-17 | Multi-factor authentication | 46.1 | No | No | No | No | NOT_STARTED |
| S-18 | Password hashing (bcrypt) | 46.1 | Yes | Yes | Yes | n/a | **COMPLETE** |
| S-19 | Password reset / email verification | 46.1 | Partial | Partial | Yes | Yes | IN_PROGRESS |
| S-20 | Login history / device mgmt / suspicious-login detection | 46.1 | No | No | Partial | No | NOT_STARTED |
| S-21 | API rate limiting | 46.2 | No | No | No | n/a | NOT_STARTED — `RATE_LIMITED` code exists, unused |
| S-22 | CAPTCHA, WAF, DDoS | 46.2 | No | No | No | No | NOT_STARTED |
| S-23 | Encryption at rest / in transit | 46.2 | Provider | n/a | n/a | n/a | INTEGRATION_COMPLETE (Neon TLS + at-rest) |
| S-24 | Field-level encryption | 46.2 | No | No | No | No | NOT_STARTED |
| S-25 | Consent / retention / export / deletion (DPDP, GDPR) | 46.3, 46.4 | No | No | No | No | NOT_STARTED |

## Part C — Identifier Engine (PRD §9)

| ID | PRD Requirement | § | Backend | API | DB | Frontend | Status |
|---|---|---|---|---|---|---|---|
| ID-01 | **Configurable ID/number generation engine** | 9 | Yes | Yes | Yes | Yes | **COMPLETE** |
| ID-02 | 23 supported identifier types | 9.1 | 4 of 23 | Yes | Yes | Yes | IN_PROGRESS |
| ID-03 | Format tokens | 9.2 | 14 of 16 | Yes | Yes | Yes | IN_PROGRESS |
| ID-04 | Prefix/suffix, padding, annual & campus reset | 9.3 | Yes | Yes | Yes | Yes | **COMPLETE** |
| ID-05 | Duplicate prevention | 9.3 | Yes | Yes | Yes | n/a | **COMPLETE** |
| ID-05b | Reserved ranges, manual override with approval | 9.3 | No | No | No | No | NOT_STARTED |
| ID-06 | Bulk generation, QR/barcode, generation audit log | 9.3 | No | No | No | No | NOT_STARTED — audit is WP-2 |
| ID-07 | Rule preview and testing | 9.3 | Yes | Yes | Yes | Yes | **COMPLETE** |
| ID-08 | ID reissue / deactivation / legacy migration | 9.3 | Partial | Yes | Yes | Yes | IN_PROGRESS — `isActive` retires; reissue not built |

### WP-1 evidence (verified against the running application)

| Check | Result |
|---|---|
| 10 / 50 / 100 concurrent generations | 10/10, 50/50, 100/100 unique — dense 1..n, no lost increments |
| Cross-tenant burst (40 + 40 simultaneous) | 0 overlap, both series dense |
| Scope isolation (2 campuses, 1 tenant) | `EMP-JPR-00010` / `EMP-DEL-00001` — independent counters |
| Transaction rollback | `lastSequence` unchanged after a failed create — no gap |
| Inactive sequence | Refused, no fallback default invented |
| Unconfigured entity | Refused, no fallback default invented |
| Preview called twice | Identical — issues nothing |
| `lastSequence` rewind attempt | 400, strict schema rejects the key |
| Foreign-tenant PATCH | 404 |
| ANON / STUDENT / FACULTY / HOD / COE / SUPER_ADMIN → config API | 401 / 403 ×5 |
| UNIVERSITY_ADMIN → config API | 200 |
| Student created with no `enrollmentNo` | `DEMO-202600001`, counter advanced by exactly 1 |
| Student created WITH `enrollmentNo` | `MANUAL-KEEP-1` preserved — backward compatible |

**Deliberately not implemented, recorded rather than dropped:** `{RAND}` and `{CHECK}` tokens (PRD §9.2). A random component cannot be previewed, and a check digit needs an algorithm the PRD does not name. No MVP consumer requires either.

**Known risk carried forward:** `Certificate.certificateNo` and `Payment.receiptNo` carry **global** unique constraints, not tenant-scoped ones. Two institutions configuring the same certificate prefix will collide on the second issue. The constraint is pre-existing and arguably deliberate (a certificate number is quoted publicly at the verification endpoint), so it was not changed; the configuration screen and the route header both state it.

**ID-01 evidence.** `model IdSequence` exists with exactly the fields the PRD describes — `entityType`, `prefix`, `suffix`, `format`, `padding`, `lastSequence`, `resetCycle`, `lastResetYear`, `lastResetMonth`. **No code reads or writes it.** Enrolment numbers are currently typed by hand into the enrol form.

## Part D — Academics (PRD §10–§13, §18)

| ID | PRD Requirement | § | Status | Note |
|---|---|---|---|---|
| A-01 | University → campus → school → dept → programme hierarchy | 2.3 | **COMPLETE** | All models + pages live-verified |
| A-02 | Academic year / semester / batch / section | 11.1 | **COMPLETE** | |
| A-03 | Curriculum versioning, credits, prerequisites | 11.2 | INTEGRATION_COMPLETE | Prereq validation not surfaced |
| A-04 | Open electives (preference → allocation) | 11.2 | **COMPLETE** | |
| A-05 | Course registration + credit-limit + prerequisite validation | 11.3 | IN_PROGRESS | Registration exists; add/drop window, waitlist, adviser approval missing |
| A-06 | Timetable (class/faculty/room) | 12 | INTEGRATION_COMPLETE | Conflict detection & auto-generation missing |
| A-07 | Attendance marking + report | 13 | **COMPLETE** | |
| A-08 | Attendance lock / unlock / audit (Phase 22) | 13.2 | BACKEND_COMPLETE | **No UI** |
| A-09 | Attendance methods: QR, RFID, biometric, geo-fence, facial | 13.1 | NOT_STARTED | Faculty-marked only |
| A-10 | Grading, GPA/CGPA, results, transcripts | 18 | INTEGRATION_COMPLETE | |
| A-11 | Promotion rules, degree audit, graduation eligibility | 18 | NOT_STARTED | |
| A-12 | Student profile / lifecycle / self-service | 10 | INTEGRATION_COMPLETE | 8 of 24 self-service items |
| A-13 | Student ID card | 10.3 | NOT_STARTED | |
| A-14 | Internal assessment engine (Phase 25) | 16 | BACKEND_COMPLETE | **No UI** |

## Part E — Modules with no implementation at all

Each of these is a full PRD section with **zero models, zero APIs, zero pages**.

| ID | PRD Requirement | § | Status |
|---|---|---|---|
| E-01 | Public university website (26 pages) | 7.1 | NOT_STARTED |
| E-02 | Website CMS / page builder / SEO / A-B testing | 7.3 | NOT_STARTED |
| E-03 | Enquiry & lead management (admissions CRM) | 8.1 | NOT_STARTED |
| E-04 | Online application + applicant portal | 8.2 | NOT_STARTED |
| E-05 | Applicant verification (OCR, ID, fraud, blacklist) | 8.3 | NOT_STARTED |
| E-06 | Admission selection (merit, seat matrix, offers) | 8.4 | NOT_STARTED |
| E-07 | Student conversion automation | 8.5 | NOT_STARTED |
| E-08 | LMS — course builder, video, SCORM, H5P, live classes | 14 | NOT_STARTED |
| E-09 | Certification course marketplace | 15 | NOT_STARTED |
| E-10 | Quizzes (20 question types) | 16.2 | NOT_STARTED |
| E-11 | Online examination + proctoring | 17.3 | NOT_STARTED |
| E-12 | Evaluation (on-screen marking, double/blind, moderation) | 17.4 | NOT_STARTED |
| E-13 | Certificate template builder (drag-and-drop) | 19.2 | NOT_STARTED — static templates only |
| E-14 | Full finance & accounting (GL, AP/AR, budgets, tax) | 24 | NOT_STARTED |
| E-15 | Scholarships & financial aid | 25 | NOT_STARTED |
| E-16 | HRMS (recruitment, payroll, leave, performance) | 22 | NOT_STARTED — `Employee` model only |
| E-17 | Library management | 26 | NOT_STARTED |
| E-18 | Hostel management | 27 | NOT_STARTED |
| E-19 | Transport management | 28 | NOT_STARTED |
| E-20 | Inventory / assets / procurement / vendors | 36, 37 | NOT_STARTED |
| E-21 | Helpdesk & support tickets | 38 | NOT_STARTED |
| E-22 | Grievances / discipline / wellness | 35 | NOT_STARTED |
| E-23 | Placements & recruiter portal | 29 | NOT_STARTED |
| E-24 | Research management | 30 | NOT_STARTED |
| E-25 | Alumni management | 31 | NOT_STARTED |
| E-26 | Events, clubs, elections | 34 | NOT_STARTED |
| E-27 | Document management system | 39 | NOT_STARTED |
| E-28 | AI assistants & administrative AI | 40 | NOT_STARTED |
| E-29 | Analytics & BI / custom report builder | 41 | NOT_STARTED |
| E-30 | Accreditation (NAAC/NBA/NIRF/UGC) | 42 | NOT_STARTED |
| E-31 | Mobile applications (Flutter) | 43 | NOT_STARTED |
| E-32 | Integrations (payments, comms, identity, ERP) | 44 | NOT_STARTED |
| E-33 | Data migration tooling | 54 | NOT_STARTED |

## Part F — Portals (PRD §57)

| ID | Portal | Status | Note |
|---|---|---|---|
| PT-01 | Super Admin | INTEGRATION_COMPLETE | 4 of 15 PRD nav items |
| PT-02 | University Administration | INTEGRATION_COMPLETE | 9 of 23 PRD nav items |
| PT-03 | Faculty | INTEGRATION_COMPLETE | 6 of 16 PRD nav items |
| PT-04 | Student | INTEGRATION_COMPLETE | 11 of 16 PRD nav items |
| PT-05 | Parent | NOT_STARTED | `Parent`/`StudentParent` models exist, no portal |
| PT-06 | Applicant | NOT_STARTED | |
| PT-07 | Employee | NOT_STARTED | |
| PT-08 | Librarian | NOT_STARTED | |
| PT-09 | Hostel Warden | NOT_STARTED | |
| PT-10 | Transport Manager | NOT_STARTED | |
| PT-11 | Placement Officer | NOT_STARTED | |
| PT-12 | Recruiter | NOT_STARTED | |
| PT-13 | Alumni | NOT_STARTED | |
| PT-14 | Vendor | NOT_STARTED | |
| PT-15 | Auditor | NOT_STARTED | |

## Part G — Communication (PRD §33) — recently built

| ID | Requirement | Status |
|---|---|---|
| C-01 | In-app notifications + notification centre | **INTEGRATION_COMPLETE** — live-verified 5 of 6 roles |
| C-02 | Announcements (audience-scoped, pinned, read state) | BACKEND_COMPLETE — no UI |
| C-03 | Emergency alerts | BACKEND_COMPLETE — `EMERGENCY` category exists |
| C-04 | Email / SMS / WhatsApp / push | NOT_STARTED — nothing transmits; `sentAt` deliberately left null |
| C-05 | Templates / approval / delivery tracking / read receipts | Partial — `NotificationTemplate` model exists, unused |
| C-06 | Chat, forums, community groups | NOT_STARTED |

**C-01 known gap:** `CONTROLLER_OF_EXAMINATION` is absent from `NOTIFICATION_CENTER_ROLES`, so a COE receives 403 and sees an Unavailable state. Backend decision, not changed here.

---

## Completion summary

| Area | PRD requirements | Verified complete | Partial | Not started |
|---|---|---|---|---|
| Platform | 22 | 8 | 3 | 11 |
| Security & identity | 25 | 6 | 5 | 14 |
| Identifier engine | 9 | 4 | 3 | 2 |
| Academics | 14 | 5 | 6 | 3 |
| Whole modules | 33 | 0 | 0 | 33 |
| Portals | 15 | 4 | 0 | 11 |
| Communication | 6 | 1 | 2 | 3 |
| **Total** | **124** | **28** | **18** | **78** |

**Overall PRD completion: ≈ 30%** (24% → WP-1 28% → WP-2 29% → WP-3 30%) — counting partials at half weight (28 + 9) / 124.

This is a *breadth* measure against a PRD the document itself scopes at **12–18 months with parallel teams** (§52). What exists is deep and production-grade in its areas; the gap is coverage, not quality.

---

## Dependency graph

```
        ┌──────────────── DONE ────────────────┐
        │  Authentication → Session → Tenant   │
        │  → RBAC → University Structure       │
        │  → Students/Faculty → Courses        │
        │  → Timetable → Attendance            │
        │  → Assignments → Evaluation          │
        │  → Results → Certificates → Fees     │
        └───────────────────┬──────────────────┘
                            │
        ┌───────────────────▼──────────────────────────┐
        │  PHASE 1 REMAINDER  (blocks everything else) │
        │                                              │
        │   Domain Resolution ──┐                      │
        │   White-label Branding┤→ per-tenant identity │
        │   Identifier Engine ──┤→ every new entity    │
        │   Audit Surface ──────┤→ every state change  │
        │   Global Masters ─────┘→ every dropdown      │
        └───────────────────┬──────────────────────────┘
                            │
      ┌─────────────────────┼─────────────────────┐
      ▼                     ▼                     ▼
  Admissions            Parent Portal         Website/CMS
  (needs ID engine,     (needs Parent role,   (needs branding,
   audit, masters)       record-level perms)   domains)
      │
      ▼
  Applicant → Application → Verification → Selection
  → Offer → Fee Payment → Student Conversion
      │
      ▼
  LMS → Online Exams → Advanced Certification
      │
      ▼
  HRMS → Library/Hostel/Transport → Placements
  → Research → Alumni → AI → Analytics → Accreditation
```

**Why the Phase-1 remainder blocks the rest:**
- **Identifier engine** — Admissions (§8.5) requires auto-generated applicant number, application number, student ID and enrolment number. Building admissions first means hand-typed ids, then retrofitting.
- **Audit surface** — §13 requires *every* admission transition to carry an audit record with actor, timestamp and reason. Writes already happen; nothing can read them.
- **Domain resolution** — the applicant portal lives on `admissions.university.edu` (§5.2). Without `Domain` lookup that host resolves to nothing.
- **Branding** — the public website and applicant portal are the first tenant-branded surfaces.
- **Global masters** — application forms need country/state, qualification and document-type masters.

## Recommended implementation order

| Order | Phase | PRD § | Rationale |
|---|---|---|---|
| **1** | **Platform Foundation remainder** | 5.2, 9, 45, 47, 5.5 | Blocks everything; four models already exist unused |
| 2 | Parent Portal | 32 | Models exist; smallest complete new portal; exercises record-level permissions |
| 3 | Admissions + Applicant Portal | 8 | Largest business value; depends on order 1 |
| 4 | Website + CMS | 7 | Depends on branding + domains |
| 5 | LMS | 14 | Largest single module |
| 6 | Finance / HRMS | 24, 22 | |
| 7 | Campus operations | 26–28, 36–38 | |
| 8 | Placements / Research / Alumni | 29–31 | |
| 9 | AI / Analytics / Accreditation | 40–42 | Needs all upstream data |

## Phase 1 remainder — the four work packages

| WP | Scope | Existing asset | Missing |
|---|---|---|---|
| **WP-1** | Identifier engine | `IdSequence` (14 fields, complete) | Service, API, admin UI, wiring into student/employee/certificate creation |
| **WP-2** | Audit log surface | `AuditLog` + repository + 30 write sites | Read API, filters, page, export |
| **WP-3** | Domain resolution & management | `Domain` (8 fields) | Lookup in `requireTenant`, CRUD API, verification, Super Admin UI |
| **WP-4** | White-label branding | 6 `Tenant` columns | Read/write API, CSS-variable injection, Super Admin UI |

**Recommended first work package: WP-1, the Identifier Engine (PRD §9).**

It is the deepest dependency — §8.5 student conversion, §22.1 employee ID, §19 certificate numbers, §17.2 exam roll numbers and §23 receipt numbers all consume it. The model is already designed to the PRD's specification and has never been used, so this is wiring an existing asset rather than new architecture.

---

## Open questions for the product owner

These are recorded rather than guessed, per the instruction not to invent requirements.

1. **Scope reality.** The PRD scopes itself at 12–18 months with ~18 parallel specialists (§52, §53). Completing all 120 requirements is not achievable in this engagement. Which subset constitutes "done"? The PRD's own **MVP list (§51)** is the natural answer and is what I would recommend targeting.
2. **Role model.** The PRD names ~50 roles; 9 exist. Should the remaining ~41 be seeded as data (custom roles per §4.3), or hard-coded constants like the current nine?
3. **Tenant isolation model.** §48.2 offers four models. The build uses #1 (shared DB, tenant rows). Confirm that stands.
4. **Stack divergence.** §48.1 recommends **NestJS** for the backend; this repo uses Next.js route handlers. This is a real, load-bearing divergence from the PRD. My recommendation is to keep the current architecture — it is working, tested and production-grade — and record the divergence rather than rewrite. Confirm.
5. **Infrastructure.** §48.1 assumes Redis, OpenSearch, S3, Kafka/RabbitMQ, Kubernetes. None are provisioned. Several PRD features (queues, search, video, caching) cannot be honestly built without them.
