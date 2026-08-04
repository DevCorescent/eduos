# eduOS — Frontend Plan (Dharmesh)

**Assigned to:** Dharmesh  
**Stack:** Next.js 16 App Router · React 19 · Tailwind CSS v4 · TypeScript  
**Branch convention:** `dev/dharmesh` → PR → `main`

All APIs are already live on the backend. This doc maps every page to the exact
API it calls so there is no guesswork.

---

## Ground Rules

- Every page is a **React Server Component** by default. Add `"use client"` only
  when you need state, effects, or browser events.
- `params` in Next.js 16 is a **Promise** — always `await params` before
  destructuring. Example:
  ```ts
  export default async function Page({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
  }
  ```
- Use the shared API response envelope: `{ success, data, error }` — all backend
  APIs return this shape. Check `success` before reading `data`.
- Fetch on the server where possible (avoids loading spinners). Use client
  components only for forms, modals, and real-time interactions.
- No external UI library — build from scratch with Tailwind v4. Keep components
  composable and reusable.

---

## Portals Overview

There are **4 separate portals**, each with its own layout and nav:

| Portal | Route Group | Who uses it |
|---|---|---|
| Platform Admin | `(platform)` | SUPER_ADMIN only |
| University Admin | `(university)` | UNIVERSITY_ADMIN, CAMPUS_ADMIN, HOD |
| Faculty Portal | `(portals)/faculty` | FACULTY role |
| Student Portal | `(portals)/student` | STUDENT role |

Auth pages (`(auth)`) are shared across all roles.

---

## Phase F1 — Design System & Shared Components

**Branch:** `dev/dharmesh`  
**No API calls — pure UI building blocks**

Build these components in `components/ui/` before writing any pages.
Every other phase depends on them.

### Components to build

```
components/
├── ui/
│   ├── Button.tsx         — variants: primary, secondary, ghost, danger; sizes: sm, md, lg
│   ├── Input.tsx          — with label, error message, helper text
│   ├── Select.tsx         — dropdown, controlled
│   ├── Textarea.tsx
│   ├── Badge.tsx          — status chips: Active, Inactive, Suspended etc.
│   ├── Card.tsx           — white box with optional header + footer slots
│   ├── Table.tsx          — thead/tbody, striped rows, empty state
│   ├── Pagination.tsx     — prev/next + page numbers, reads ?page= from URL
│   ├── Modal.tsx          — dialog overlay, close on Escape + backdrop click
│   ├── Spinner.tsx        — loading indicator
│   ├── Alert.tsx          — success / error / warning / info banners
│   ├── Avatar.tsx         — initials fallback if no image
│   ├── Breadcrumb.tsx     — links separated by /
│   ├── Tabs.tsx           — horizontal tab bar with active indicator
│   ├── SearchInput.tsx    — debounced text input for search
│   └── StatCard.tsx       — big number + label + optional trend arrow
└── layout/
    ├── Sidebar.tsx        — collapsible nav sidebar (used by all portals)
    ├── Topbar.tsx         — page title + user menu on the right
    ├── PageHeader.tsx     — title + subtitle + optional action button
    └── EmptyState.tsx     — illustration + message + optional CTA
```

---

## Phase F2 — Auth Pages

**Route group:** `app/(auth)/`  
**Existing:** `login/page.tsx` (basic shell — needs proper styling)

### Pages

#### Login — `(auth)/login/page.tsx` ✏️ (restyle existing)
- Fields: Institution Code (slug), Email, Password
- On success → redirect based on role:
  - `SUPER_ADMIN` → `/platform/dashboard`
  - `UNIVERSITY_ADMIN` / `CAMPUS_ADMIN` / `HOD` → `/dashboard`
  - `FACULTY` → `/faculty/dashboard`
  - `STUDENT` → `/student/dashboard`
- API: `POST /api/auth/login`

#### Forgot Password — `(auth)/forgot-password/page.tsx`
- Field: Email + Institution Code
- Shows "OTP sent" confirmation step
- API: `POST /api/auth/forgot-password`

#### Reset Password — `(auth)/reset-password/page.tsx`
- Fields: OTP, New Password, Confirm Password
- API: `POST /api/auth/reset-password`

---

## Phase F3 — Platform Admin Portal

**Route group:** `app/(platform)/`  
**Access:** SUPER_ADMIN only (layout already guards this)  
**Sidebar links:** Dashboard · Tenants · Subscriptions

### Pages

#### Dashboard — `(platform)/dashboard/page.tsx`
- 4 stat cards: Total Universities, Active, Trial, Revenue
- Recent tenants table (last 10)
- API: `GET /api/platform/tenants?page=1&limit=10`

#### Tenant List — `(platform)/tenants/page.tsx`
- Searchable, paginated table: Name · Type · Status · Plan · Created
- Status badge (ACTIVE = green, TRIAL = yellow, SUSPENDED = red)
- "Onboard University" button → opens modal
- API: `GET /api/platform/tenants`

#### Onboard University Modal
- Fields: Name, Slug, Type (dropdown), Contact Email, Contact Phone
- API: `POST /api/platform/tenants`

#### Tenant Detail — `(platform)/tenants/[id]/page.tsx`
- Tabs: Overview · Stats · Subscription
- Overview: all tenant fields, editable inline
- Stats: student count, faculty count (pulled from stats endpoint)
- Subscription: current plan, status, change plan button
- APIs:
  - `GET /api/platform/tenants/[id]`
  - `GET /api/platform/tenants/[id]/stats`
  - `PATCH /api/platform/tenants/[id]`

#### Subscriptions — `(platform)/subscriptions/page.tsx`
- Table: Tenant · Plan · Status · Billing Cycle · End Date
- Click row → edit plan/status inline
- API: `GET /api/platform/subscriptions`, `PATCH /api/platform/subscriptions/[id]`

---

## Phase F4 — University Admin Portal

**Route group:** `app/(university)/`  
**Access:** UNIVERSITY_ADMIN, CAMPUS_ADMIN, HOD

### Sidebar structure

```
Dashboard
Setup
  ├── Campuses
  ├── Schools
  ├── Departments
  ├── Programmes
  └── Specialisations
Academic Calendar
  ├── Academic Years
  ├── Semesters
  ├── Batches
  └── Sections
People
  ├── Students
  ├── Faculty
  └── Employees
Users & Roles
Finance (Phase F9)
Certificates (Phase F10)
```

#### Dashboard — `(university)/dashboard/page.tsx` ✏️ (fill in the shell)
- Stat cards: Students · Faculty · Courses Running · Pending Fee Demands
- Quick links to setup sections
- API: fetch counts from respective list endpoints

#### Campuses — `(university)/setup/campuses/page.tsx`
- Table: Name · Code · Main Campus · Actions
- Add/Edit in modal
- API: `GET /api/campuses`, `POST /api/campuses`, `PATCH /api/campuses/[id]`, `DELETE /api/campuses/[id]`

#### Schools — `(university)/setup/schools/page.tsx`
- Filter by Campus
- API: `GET /api/schools`, `POST /api/schools`, `PATCH /api/schools/[id]`

#### Departments — `(university)/setup/departments/page.tsx`
- Filter by Campus + School
- API: `GET /api/departments`, `POST /api/departments`, `PATCH /api/departments/[id]`

#### Programmes — `(university)/setup/programmes/page.tsx`
- Table: Name · Code · Type · Duration · Department
- API: `GET /api/programmes`, `POST /api/programmes`, `PATCH /api/programmes/[id]`

#### Programme Detail — `(university)/setup/programmes/[id]/page.tsx`
- Tabs: Details · Specialisations
- API: `GET /api/programmes/[id]`, `GET /api/programmes/[id]/specialisations`

#### Academic Years — `(university)/calendar/academic-years/page.tsx`
- Table with "Set as Current" button
- API: `GET /api/academic-years`, `POST /api/academic-years`, `PATCH /api/academic-years/[id]`

#### Semesters — `(university)/calendar/academic-years/[id]/page.tsx`
- List semesters for the year, add new
- API: `GET /api/academic-years/[id]/semesters`, `POST /api/academic-years/[id]/semesters`

#### Batches — `(university)/calendar/batches/page.tsx`
- Filter by Programme + Academic Year
- API: `GET /api/batches`, `POST /api/batches`

#### Sections — `(university)/calendar/batches/[id]/page.tsx`
- List and create sections for a batch
- API: `GET /api/batches/[id]/sections`, `POST /api/batches/[id]/sections`

---

## Phase F5 — Users & RBAC UI

**Route:** `app/(university)/users/`

#### User List — `(university)/users/page.tsx`
- Table: Name · Email · Roles · Status · Last Login
- "Invite User" button → modal with email + role selection
- API: `GET /api/users`, `POST /api/users`

#### User Detail — `(university)/users/[id]/page.tsx`
- Profile card + role badges
- Assign/remove roles inline
- APIs: `GET /api/users/[id]`, `POST /api/users/[id]/roles`, `DELETE /api/users/[id]/roles/[roleId]`

#### Roles — `(university)/users/roles/page.tsx`
- List roles + permissions count
- Create custom role modal
- API: `GET /api/roles`, `POST /api/roles`

---

## Phase F6 — Students UI

**Route:** `app/(university)/students/`

#### Student List — `(university)/students/page.tsx`
- Table: Enrollment No · Name · Programme · Batch · Status
- Search by name/enrollment, filter by programme/batch/status
- "Enroll Student" button → multi-step form (below)
- API: `GET /api/students`

#### Enroll Student — Multi-step form (modal or dedicated page)
1. Basic info: name, email, password, phone
2. Academic: programme, batch, section, semester
3. Review + Submit
- API: `POST /api/students`

#### Student Profile — `(university)/students/[id]/page.tsx`
- Tabs: Overview · Personal · Documents · Parents · Transcript
- **Overview:** enrollment no, status, batch, section, semester
- **Personal:** DOB, gender, blood group, address — editable form
  - API: `GET /api/students/[id]/personal`, `PUT /api/students/[id]/personal`
- **Documents:** upload list with type badges, verified indicator
  - API: `GET /api/students/[id]/documents`, `POST /api/students/[id]/documents`
- **Parents:** parent cards with relation + contact
  - API: `GET /api/students/[id]/parents`, `POST /api/students/[id]/parents`
- **Transcript:** table of all exam results grouped by semester
  - API: `GET /api/students/[id]/transcript`

---

## Phase F7 — Faculty & Staff UI

**Route:** `app/(university)/faculty/`

#### Faculty List — `(university)/faculty/page.tsx`
- Table: Employee ID · Name · Department · Designation · Status
- Search + filter by department
- API: `GET /api/faculty`

#### Faculty Profile — `(university)/faculty/[id]/page.tsx`
- Tabs: Overview · Course Assignments
- **Overview:** designation, qualification, experience, join date — editable
- **Course Assignments:** table of assigned courses with semester/section
  - Add assignment modal: pick course + optional section + semester
  - APIs: `GET /api/faculty/[id]/assignments`, `POST /api/faculty/[id]/assignments`

#### Employees — `(university)/employees/page.tsx`
- Non-teaching staff list
- API: `GET /api/employees`, `POST /api/employees`

---

## Phase F8 — Curriculum & Courses UI

> Backend (Phase 8) will be built in parallel — coordinate with backend team.

**Route:** `app/(university)/curriculum/`

#### Courses — `(university)/curriculum/courses/page.tsx`
- Course catalog: Code · Name · Type · Credits · Department
- Create course modal
- API: `GET /api/courses`, `POST /api/courses`

#### Curriculum Builder — `(university)/curriculum/[id]/page.tsx`
- Left: curriculum metadata (programme, version, effective date)
- Right: semester-by-semester subject list (drag to reorder)
- Add subject modal: search courses, set credits, mark compulsory
- API: `GET /api/curricula/[id]`, `POST /api/curricula/[id]/subjects`

---

## Phase F9 — Timetable & Attendance UI

> Backend (Phase 9) will be built in parallel.

#### Timetable Grid — `(university)/timetable/page.tsx`
- Week grid (Mon–Sat × time slots)
- Filter by Section
- Click empty slot → assign course + faculty
- API: `GET /api/timetables/section/[sectionId]`, `POST /api/timetables`

#### Mark Attendance — `(university)/attendance/mark/page.tsx`
- Select: Section + Course + Date
- Student list with Present/Absent/Late toggle per row
- Bulk "All Present" button
- Submit → `POST /api/attendance`

#### Attendance Report — `(university)/attendance/report/page.tsx`
- Filter: student or section
- Table: Course · Total Classes · Present · % — colour coded below threshold
- API: `GET /api/attendance/report/[studentId]`

---

## Phase F10 — Finance UI

> Backend (Phase 11) will be built in parallel.

#### Fee Structures — `(university)/finance/fee-structures/page.tsx`
- List structures, create new
- Structure detail: list of fee components (type, amount, taxable)
- API: `GET /api/fee-structures`, `POST /api/fee-structures`

#### Generate Demands — `(university)/finance/fee-demands/generate/page.tsx`
- Select batch + semester + fee structure → preview → generate
- API: `POST /api/fee-demands/generate`

#### Fee Ledger — `(university)/finance/fee-demands/page.tsx`
- Filter by student / semester / status
- Row actions: view, waive
- API: `GET /api/fee-demands`, `PATCH /api/fee-demands/[id]/waive`

#### Finance Report — `(university)/finance/report/page.tsx`
- Collection stats by programme/semester in a summary table
- API: `GET /api/finance/report`

---

## Phase F11 — Student Portal

**Route group:** `app/(portals)/student/`  
**Access:** STUDENT role only

### Layout
Sidebar links: Dashboard · My Attendance · Assignments · Exams · Fees · Certificates

#### Student Dashboard — `(portals)/student/dashboard/page.tsx`
- My info card (enrollment no, semester, section)
- Attendance summary (% per course — warning if below 75%)
- Upcoming assignments (due this week)
- Pending fee demands

#### My Attendance — `(portals)/student/attendance/page.tsx`
- Table: Course · Total · Present · Absent · %
- Colour highlight: red < 75%, amber < 85%, green ≥ 85%
- API: `GET /api/attendance/report/[studentId]` (studentId from session)

#### Assignments — `(portals)/student/assignments/page.tsx`
- List of assignments with status badges
- Click → detail with submission form (file upload or text)
- API: `GET /api/assignments`, `POST /api/assignments/[id]/submissions`

#### Exam Results — `(portals)/student/results/page.tsx`
- Semester-wise result table: Subject · Marks · Grade · Pass/Fail
- API: `GET /api/students/[id]/results`

#### My Fees — `(portals)/student/fees/page.tsx`
- Outstanding demands + payment history
- API: `GET /api/students/[id]/fee-demands`

#### My Certificates — `(portals)/student/certificates/page.tsx`
- List of issued certificates with download/verify links
- API: `GET /api/students/[id]/certificates`

---

## Phase F12 — Faculty Portal

**Route group:** `app/(portals)/faculty/`  
**Access:** FACULTY role only

### Layout
Sidebar links: Dashboard · My Schedule · Attendance · Assignments · Exams

#### Faculty Dashboard — `(portals)/faculty/dashboard/page.tsx`
- Today's schedule (timetable slots for today)
- Pending assignments to grade
- Attendance due (sections not yet marked today)

#### My Schedule — `(portals)/faculty/schedule/page.tsx`
- Week grid view (read-only) of timetable
- API: `GET /api/timetables/faculty/[facultyId]`

#### Mark Attendance — `(portals)/faculty/attendance/mark/page.tsx`
- Select course + date (defaults to today)
- Student list with toggle
- API: `POST /api/attendance`

#### My Assignments — `(portals)/faculty/assignments/page.tsx`
- Assignments I created (list + status)
- Create assignment → select course/section, set due date, description
- Click assignment → view submissions list with grading
- APIs: `GET /api/assignments`, `POST /api/assignments`, `PATCH /api/assignments/[id]/submissions/[sid]`

#### Exams — `(portals)/faculty/exams/page.tsx`
- Scheduled exams for my courses
- Upload results (CSV or row-by-row form)
- APIs: `GET /api/examinations`, `POST /api/examinations/[id]/results`

---

## Phase F13 — Certificates UI

**Route:** `app/(university)/certificates/`

#### Template Builder — `(university)/certificates/templates/page.tsx`
- List templates + "New Template" button
- Editor: HTML textarea + live preview iframe
- Variable picker sidebar (inserts `{{studentName}}` etc.)
- API: `GET /api/certificate-templates`, `POST /api/certificate-templates`

#### Issue Certificate — `(university)/certificates/issue/page.tsx`
- Select student + template → preview → issue
- API: `POST /api/certificates/issue`

#### Public Verify — `app/(public)/verify/[certNo]/page.tsx`
- No auth required
- Show certificate metadata + validity status
- API: `GET /api/certificates/verify/[certNo]`

---

## File Structure for Dharmesh

```
app/
├── (auth)/
│   ├── layout.tsx              ✅ exists
│   ├── login/page.tsx          ✅ needs restyle
│   ├── forgot-password/page.tsx
│   └── reset-password/page.tsx
│
├── (platform)/
│   ├── layout.tsx              ✅ exists
│   ├── dashboard/page.tsx
│   ├── tenants/
│   │   ├── page.tsx
│   │   └── [id]/page.tsx
│   └── subscriptions/page.tsx
│
├── (university)/
│   ├── layout.tsx              ✅ exists (needs proper sidebar)
│   ├── dashboard/page.tsx      ✅ exists (fill in data)
│   ├── setup/
│   │   ├── campuses/page.tsx
│   │   ├── schools/page.tsx
│   │   ├── departments/page.tsx
│   │   └── programmes/
│   │       ├── page.tsx
│   │       └── [id]/page.tsx
│   ├── calendar/
│   │   ├── academic-years/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── batches/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   └── sections/
│   ├── users/
│   │   ├── page.tsx
│   │   ├── [id]/page.tsx
│   │   └── roles/page.tsx
│   ├── students/
│   │   ├── page.tsx
│   │   └── [id]/page.tsx
│   ├── faculty/
│   │   ├── page.tsx
│   │   └── [id]/page.tsx
│   ├── employees/page.tsx
│   ├── curriculum/
│   │   ├── courses/page.tsx
│   │   └── [id]/page.tsx
│   ├── timetable/page.tsx
│   ├── attendance/
│   │   ├── mark/page.tsx
│   │   └── report/page.tsx
│   ├── finance/
│   │   ├── fee-structures/page.tsx
│   │   ├── fee-demands/page.tsx
│   │   └── report/page.tsx
│   └── certificates/
│       ├── templates/page.tsx
│       └── issue/page.tsx
│
├── (portals)/
│   ├── student/
│   │   ├── layout.tsx
│   │   ├── dashboard/page.tsx  ✅ dir exists
│   │   ├── attendance/page.tsx
│   │   ├── assignments/page.tsx
│   │   ├── results/page.tsx
│   │   ├── fees/page.tsx
│   │   └── certificates/page.tsx
│   └── faculty/
│       ├── layout.tsx
│       ├── dashboard/page.tsx  ✅ dir exists
│       ├── schedule/page.tsx
│       ├── attendance/
│       │   └── mark/page.tsx
│       ├── assignments/page.tsx
│       └── exams/page.tsx
│
└── (public)/
    └── verify/[certNo]/page.tsx  ← public certificate check

components/
├── ui/                          — Button, Input, Card, Table, Modal, Badge...
└── layout/                      — Sidebar, Topbar, PageHeader, EmptyState
```

---

## Build Order for Dharmesh

Start with the foundation — every phase after F1 depends on it.

| # | Phase | Depends on |
|---|---|---|
| F1 | Design System (components/ui) | nothing |
| F2 | Auth Pages | F1 |
| F3 | Platform Admin Portal | F1, F2 |
| F4 | University Setup UI | F1, F2 |
| F5 | Users & RBAC | F1, F4 |
| F6 | Students UI | F1, F4, F5 |
| F7 | Faculty & Staff UI | F1, F4 |
| F8 | Curriculum & Courses | F1, F4 (wait for backend Phase 8) |
| F9 | Timetable & Attendance | F1, F6, F7 (wait for backend Phase 9) |
| F10 | Finance | F1, F6 (wait for backend Phase 11) |
| F11 | Student Portal | F1, F6, F9, F10 |
| F12 | Faculty Portal | F1, F7, F9 |
| F13 | Certificates | F1 (wait for backend Phase 12) |

---

## API Base URL

All fetch calls hit the same Next.js app — use relative paths:

```ts
// Server component (no auth header needed — cookie is automatic)
const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/students`, {
  cache: "no-store",
})

// Client component
const res = await fetch("/api/students")
```

---

## Notes for Dharmesh

1. **Don't install any UI library** (shadcn, MUI, Radix) — build from Tailwind v4 primitives.
2. **Server fetch > client fetch** — fetch data in the page component, pass as props to client components.
3. **Always handle the error state** — show `<Alert>` when `success: false`.
4. **Pagination** — all list APIs support `?page=&limit=`. Wire `<Pagination>` to URL search params.
5. **Tenant scope is automatic** — the JWT cookie carries `tenantId`. No need to pass it manually in API calls.
6. **Role-based nav** — check `session.roles` to show/hide sidebar links (faculty shouldn't see finance, etc.)
