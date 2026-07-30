# Technical Debt

Accepted limitations recorded during backend implementation.

Every entry uses the same structure: **ID, Title, Status, Severity, Category,
Verification, Problem, Impact, Evidence, Affected Components, Proposed
Resolution, Decision.**

---

## TD-001 — FacultyAssignment uniqueness with nullable columns

**ID:** TD-001
**Title:** FacultyAssignment uniqueness with nullable columns
**Status:** Accepted
**Severity:** High
**Category:** Schema

### Verification

Confirmed by automated concurrency testing.
Reproduced on PostgreSQL (Neon).
Evidence includes the measured race (1 row vs 2 rows).

### Problem

`FacultyCourseAssignment` declares its identity as

```prisma
@@unique([facultyId, courseId, sectionId, semesterId])
```

`sectionId` and `semesterId` are both nullable. Prisma emits this as a plain
four-column unique index:

```sql
CREATE UNIQUE INDEX "FacultyCourseAssignment_facultyId_courseId_sectionId_semest_key"
  ON "FacultyCourseAssignment"("facultyId", "courseId", "sectionId", "semesterId");
```

PostgreSQL treats `NULL` values as distinct within a unique index, so
`(faculty, course, NULL, NULL)` does not conflict with an identical existing row.
The constraint therefore expresses an intent the database only enforces when
**both** optional columns are supplied.

### Impact

Duplicate assignments can be created for the same faculty member and course when
`sectionId` and `semesterId` are omitted, if the requests arrive concurrently.

- The application pre-check catches this for sequential requests, so the defect
  surfaces only under contention.
- `GET /api/faculty/[id]/assignments` will list the duplicates, and
  `pagination.total` counts them, so the incorrect state is visible through the
  API rather than hidden.
- No downstream consumer misreads it **yet**: no timetable, workload or
  course-allocation feature has been built against this model. The cost today is
  incorrect data plus whatever any future consumer derives from it — which is why
  the entry is recorded rather than deferred silently.
- Assignments that specify both a section and a semester are unaffected; the
  index engages normally for those.

### Evidence

Measured against the live database, six concurrent `POST` requests per run:

| `sectionId` / `semesterId` | Responses | Rows created |
| --- | --- | --- |
| both supplied | 1 × 201, 5 × 409 | 1 |
| both omitted (`NULL`) | 2 × 201, 4 × 409 | **2** |

The second run created a genuine duplicate. The pre-check rejected four of six
requests; the two that raced past it had no database constraint to refuse them.
The first run is correct precisely because the index applies when neither column
is `NULL`.

### Affected Components

| Component | Involvement |
| --- | --- |
| `FacultyCourseAssignment` (Prisma model) | Origin of the limitation |
| `POST /api/faculty/[id]/assignments` | Write path where the duplicate is created |
| `GET /api/faculty/[id]/assignments` | Reflects and counts duplicate rows |
| Future assignment detail / delete routes | Will address rows no longer uniquely identifiable by the intended natural key |
| `lib/validations/faculty.ts` | Declares the shape whose optional fields trigger the gap |

### Proposed Resolution

Requires an explicit schema migration. Options, in rough order of invasiveness:

1. **Expression-based unique index** — index
   `COALESCE(sectionId, '')` and `COALESCE(semesterId, '')` so the absent case
   becomes a concrete comparable value. Preserves the nullable columns and the
   current API contract.
2. **Sentinel values with `NOT NULL`** — make both columns required and represent
   "not scoped to a section/semester" explicitly. Enforceable by the plain index,
   but changes the stored shape and every read of those columns.
3. **Redesign the uniqueness model** — if an assignment is genuinely identified by
   something narrower (for example faculty + course + semester only), state that
   key instead and let section be non-identifying.

Option 1 is the only one that closes the gap without altering the API surface.

### Decision

Accepted as a schema-level limitation, not an API implementation bug. The route
performs the duplicate pre-check the declared constraint implies; that check is
correct and effective wherever the database can back it.

Explicitly **not** to be done at the route layer:

- no route-specific workarounds
- no `SERIALIZABLE` transactions
- no advisory locks
- no divergence from the project's existing concurrency model

Revisit only via an explicit schema migration.
