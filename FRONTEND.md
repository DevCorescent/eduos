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

eduOS is organized into **5 independent portals**, each with its own layout, navigation, authorization, and user experience. Every portal consumes the same backend APIs but exposes features based on the authenticated user's role and permissions.

| Portal | Route Group | Primary Users | Purpose |
|---------|-------------|---------------|---------|
| Platform Admin | `(platform)` | SUPER_ADMIN | Platform management, tenant onboarding, subscriptions, platform analytics and monitoring |
| University Admin | `(university)` | UNIVERSITY_ADMIN, CONTROLLER_OF_EXAMINATION, CAMPUS_ADMIN, DEPARTMENT_HOD | University administration, academic setup, curriculum, evaluation, examinations, finance, reports and system administration |
| Faculty Portal | `(portals)/faculty` | FACULTY | Course management, attendance, assignments, assessments, marks entry, examinations and academic analytics |
| Student Portal | `(portals)/student` | STUDENT | Courses, attendance, timetable, assignments, examination results, transcript, fees, certificates and notifications |
| Parent Portal | `(portals)/parent` | PARENT | Student progress, attendance, examination results, fee status, certificates and notifications |

> **Authentication** (`app/(auth)`) is shared across all portals. After successful login, users are automatically redirected to their respective portal based on their assigned role(s).

> **Authorization** is enforced using Role-Based Access Control (RBAC). Navigation menus, pages, actions, and API access are rendered dynamically according to the authenticated user's permissions.
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
---

# Phase F14 — Enterprise Academic Evaluation & Result Management

> **Backend Dependency:** Phase 16 — Enterprise Academic Evaluation & Result Management
>
> **Route Group:** `app/(university)/evaluation`
>
> **Access**
>
> - UNIVERSITY_ADMIN
> - CONTROLLER_OF_EXAMINATION
> - DEPARTMENT_HOD
> - FACULTY (Role Based)
>
> This phase builds the complete frontend for the Enterprise Academic Evaluation
> System. Every page maps directly to the Phase 16 backend APIs.

---

# Sidebar Structure

```
Evaluation

├── Dashboard
├── Grade Scales
├── Evaluation Schemes
│   ├── Components
│   ├── Rules
│   └── Passing Criteria
├── Course Registrations
├── Assessment Events
├── Internal Marks
├── External Marks
├── Student Results
├── Semester Results
├── Analytics
└── Transcript
```

---

# F14.1 — Evaluation Dashboard

### Route

```
(university)/evaluation/page.tsx
```

### Features

- Dashboard Overview
- Active Regulations
- Draft Regulations
- Assessment Statistics
- Pending Result Publications
- Quick Actions
- Recent Activities

### APIs

```
GET /api/evaluation-schemes
GET /api/assessment-events
```

---

# F14.2 — Grade Scale Management

### Pages

```
evaluation/
└── grade-scales/
    ├── page.tsx
    ├── new/page.tsx
    └── [id]/
        ├── page.tsx
        └── edit/page.tsx
```

### Features

- List Grade Scales
- Create Grade Scale
- Edit Draft
- Activate
- Archive
- Grade Bands
- Version History

### APIs

```
GET    /api/grade-scales
POST   /api/grade-scales
GET    /api/grade-scales/[id]
PATCH  /api/grade-scales/[id]
DELETE /api/grade-scales/[id]
POST   /api/grade-scales/[id]/activate
POST   /api/grade-scales/[id]/archive
```

---

# F14.3 — Evaluation Schemes

### Pages

```
evaluation/
└── schemes/
    ├── page.tsx
    ├── new/page.tsx
    └── [id]/
        ├── page.tsx
        ├── edit/page.tsx
        └── versions/page.tsx
```

### Features

- List Schemes
- Create
- Edit
- Duplicate
- Activate
- Archive
- Version Timeline

### APIs

```
GET    /api/evaluation-schemes
POST   /api/evaluation-schemes
GET    /api/evaluation-schemes/[id]
PATCH  /api/evaluation-schemes/[id]
DELETE /api/evaluation-schemes/[id]
POST   /api/evaluation-schemes/[id]/activate
POST   /api/evaluation-schemes/[id]/archive
```

---

# F14.4 — Evaluation Components

### Pages

```
evaluation/
└── schemes/
    └── [id]/
        └── components/
            ├── page.tsx
            ├── new/page.tsx
            └── [componentId]/edit/page.tsx
```

### Features

- Component Tree
- Drag & Drop
- Weightage
- Aggregation
- Rollup
- Parent Components
- Child Components

### APIs

```
GET    /api/evaluation-schemes/[id]/components
POST   /api/evaluation-schemes/[id]/components
GET    /api/evaluation-schemes/[id]/components/[componentId]
PATCH  /api/evaluation-schemes/[id]/components/[componentId]
DELETE /api/evaluation-schemes/[id]/components/[componentId]
```

---

# F14.5 — Evaluation Rules

### Pages

```
evaluation/
└── schemes/
    └── [id]/
        └── rules/
            ├── page.tsx
            ├── new/page.tsx
            └── [ruleId]/edit/page.tsx
```

### Features

- Rule Builder
- Formula Builder
- Rule Ordering
- Validation
- Enable / Disable
- Rule Preview

### APIs

```
GET    /api/evaluation-schemes/[id]/rules
POST   /api/evaluation-schemes/[id]/rules
GET    /api/evaluation-schemes/[id]/rules/[ruleId]
PATCH  /api/evaluation-schemes/[id]/rules/[ruleId]
DELETE /api/evaluation-schemes/[id]/rules/[ruleId]
```

---

# F14.6 — Passing Criteria

### Pages

```
evaluation/
└── schemes/
    └── [id]/
        └── passing-criteria/
            ├── page.tsx
            ├── new/page.tsx
            └── [criterionId]/edit/page.tsx
```

### Features

- Passing Rules
- Component Rules
- Overall Rules
- Credit Rules
- Grade Rules

### APIs

```
GET    /api/evaluation-schemes/[id]/passing-criteria
POST   /api/evaluation-schemes/[id]/passing-criteria
GET    /api/evaluation-schemes/[id]/passing-criteria/[criterionId]
PATCH  /api/evaluation-schemes/[id]/passing-criteria/[criterionId]
DELETE /api/evaluation-schemes/[id]/passing-criteria/[criterionId]
```

---

# F14.7 — Course Registration

### Pages

```
evaluation/
└── course-registrations/
    ├── page.tsx
    ├── bulk/page.tsx
    ├── new/page.tsx
    └── [id]/page.tsx
```

### Features

- Student Registration
- Bulk Registration
- Registration History
- Attempt History
- Withdraw
- Cancel
- Registration Status

### APIs

```
GET    /api/course-registrations
POST   /api/course-registrations
POST   /api/course-registrations/bulk
GET    /api/course-registrations/[id]
PATCH  /api/course-registrations/[id]
```

---

# F14.8 — Assessment Events

### Pages

```
evaluation/
└── assessment-events/
    ├── page.tsx
    ├── new/page.tsx
    └── [id]/
        ├── page.tsx
        └── status/page.tsx
```

### Features

- Schedule Assessment
- Assign Faculty
- Lock
- Unlock
- Publish
- Timeline

### APIs

```
GET    /api/assessment-events
POST   /api/assessment-events
GET    /api/assessment-events/[id]
PATCH  /api/assessment-events/[id]
POST   /api/assessment-events/[id]/status
```

---

# F14.9 — Internal Marks

### Pages

```
evaluation/
└── results/
    └── internal/
        ├── page.tsx
        ├── upload/page.tsx
        └── bulk/page.tsx
```

### Features

- Marks Entry
- Bulk Upload
- CSV Upload
- Draft Save
- Validation
- Preview
- Submit

### APIs

```
POST /api/results/internal
GET  /api/assessment-events/[id]/marks
```

---

# F14.10 — External Marks

### Pages

```
evaluation/
└── results/
    └── external/
        ├── page.tsx
        ├── upload/page.tsx
        └── bulk/page.tsx
```

### Features

- University Marks Upload
- CSV Upload
- Validation
- Publish

### APIs

```
POST /api/results/external
GET  /api/assessment-events/[id]/marks
```

---

# F14.11 — Student Results

### Pages

```
evaluation/
└── results/
    └── student/
        └── [studentId]/
            └── page.tsx
```

### Features

- Subject Wise Result
- Internal Marks
- External Marks
- Total
- Grade
- Grade Point
- Credits
- SGPA
- CGPA

### APIs

```
GET /api/results/student/[studentId]
```

---

# F14.12 — Semester Results

### Pages

```
evaluation/
└── results/
    └── semester/
        └── [semesterId]/
            └── page.tsx
```

### Features

- Complete Semester Result
- Search
- Filters
- Publish
- Export
- Print

### APIs

```
GET /api/results/semester/[semesterId]
```

---

# F14.13 — Result Analytics

### Pages

```
evaluation/
└── analytics/
    └── page.tsx
```

### Features

- Student Analytics
- Faculty Analytics
- Department Analytics
- University Analytics
- Pass Percentage
- Grade Distribution
- Rank List
- Charts

### APIs

```
GET /api/results/analytics/[studentId]
```

---

# F14.14 — Transcript

### Pages

```
evaluation/
└── transcript/
    └── [studentId]/
        └── page.tsx
```

### Features

- Transcript Viewer
- SGPA History
- CGPA History
- Credits Earned
- Backlogs
- Cleared Subjects
- Download PDF
- Print

### APIs

```
GET /api/results/transcript/[studentId]
```

---

# Shared Components

```
components/
└── evaluation/
    ├── GradeScaleCard.tsx
    ├── GradeBandTable.tsx
    ├── EvaluationSchemeCard.tsx
    ├── ComponentTree.tsx
    ├── ComponentNode.tsx
    ├── RuleBuilder.tsx
    ├── FormulaBuilder.tsx
    ├── PassingCriteriaTable.tsx
    ├── AssessmentCalendar.tsx
    ├── MarksEntryTable.tsx
    ├── CSVUploader.tsx
    ├── BulkUploadDialog.tsx
    ├── StudentResultCard.tsx
    ├── SemesterResultTable.tsx
    ├── TranscriptViewer.tsx
    ├── ResultSummary.tsx
    ├── AnalyticsChart.tsx
    ├── GradeDistributionChart.tsx
    ├── RankTable.tsx
    ├── PublishDialog.tsx
    ├── LockDialog.tsx
    └── StatusTimeline.tsx
```

---

# Phase F14 Completion Checklist

- Grade Scale Management
- Evaluation Scheme Management
- Evaluation Components
- Evaluation Rules
- Passing Criteria
- Course Registration
- Assessment Events
- Internal Marks Upload
- External Marks Upload
- Student Results
- Semester Results
- Analytics Dashboard
- Transcript
- Responsive UI
- Dark Mode Support
- Form Validation
- Loading States
- Error Handling
- Empty States
- Permission Guards
- API Integration Complete
- Production Ready
---
# Phase F15 — Finance & Fee Management

Backend Dependency:
Phase 11 — Finance

Modules

- Fee Structures
- Fee Components
- Generate Fee Demands
- Student Fee Ledger
- Waivers
- Scholarships
- Fine Management
- Discounts
- Collection Reports
- Receipt Viewer
- Payment History
- Finance Dashboard

Pages

- Fee Structures
- Fee Structure Detail
- Generate Demands
- Student Ledger
- Finance Reports
- Receipt Viewer
- Waiver Management
---
# Phase F16 — Timetable & Attendance Management

Backend Dependency:
Phase 9

Modules

- Timetable Builder
- Faculty Timetable
- Student Timetable
- Attendance Entry
- Bulk Attendance
- Attendance Reports
- Attendance Analytics
- Attendance Dashboard

Pages

- Timetable Calendar
- Faculty Timetable
- Student Timetable
- Attendance Entry
- Attendance Report
- Attendance Analytics
---
# Phase F17 — Assignment & Learning Management

Backend Dependency:
Assignment Module

Modules

- Assignment Creation
- Assignment Submission
- File Upload
- Grading
- Rubrics
- Feedback
- Submission History

Pages

- Assignment List
- Assignment Details
- Submission Portal
- Faculty Evaluation
- Student Submission History
---
---

# Phase F18 — Examination Management

> **Backend Dependency:** Examination Module
>
> **Route Group:** `app/(university)/examinations`
>
> **Access**
>
> - UNIVERSITY_ADMIN
> - CONTROLLER_OF_EXAMINATION
> - DEPARTMENT_HOD
> - FACULTY (Role Based)

---

## Modules

- Examination Dashboard
- Examination Schedule
- Examination Sessions
- Hall Allocation
- Seating Plan
- Invigilator Assignment
- Admit Cards
- Examination Notices
- Practical Examination
- Viva Examination
- Examination Calendar

---

## Pages

```
examinations/
├── page.tsx
├── schedule/
├── sessions/
├── halls/
├── seating/
├── invigilators/
├── admit-cards/
├── notices/
└── practicals/
```

---

# Phase F19 — Certificates & Documents

> **Backend Dependency:** Certificate Module
>
> **Route Group:** `app/(university)/certificates`

---

## Modules

- Certificate Dashboard
- Certificate Templates
- Template Builder
- Certificate Variables
- Certificate Preview
- Issue Certificate
- Certificate History
- Certificate Verification
- Student Certificates
- Digital Signature Support

---

## Pages

```
certificates/
├── page.tsx
├── templates/
├── builder/
├── issue/
├── preview/
├── history/
├── verify/
└── student/
```

---

# Phase F20 — Complete Student Portal

> **Route Group:** `app/(portals)/student`

---

## Modules

- Dashboard
- Profile
- My Courses
- Course Registration
- Attendance
- Timetable
- Assignments
- Internal Marks
- External Marks
- Results
- Transcript
- SGPA / CGPA
- Fee Ledger
- Payments
- Certificates
- Notifications
- Downloads
- Academic Calendar

---

## Pages

```
student/
├── dashboard/
├── profile/
├── courses/
├── registrations/
├── timetable/
├── attendance/
├── assignments/
├── results/
├── transcript/
├── fees/
├── certificates/
├── notifications/
└── calendar/
```

---

# Phase F21 — Complete Faculty Portal

> **Route Group:** `app/(portals)/faculty`

---

## Modules

- Faculty Dashboard
- My Courses
- Course Registration View
- Timetable
- Attendance
- Assignment Management
- Marks Entry
- Internal Assessment
- External Assessment
- Student Performance
- Result Analytics
- Examination Duties
- Notifications

---

## Pages

```
faculty/
├── dashboard/
├── courses/
├── timetable/
├── attendance/
├── assignments/
├── marks/
├── assessments/
├── analytics/
├── examinations/
└── notifications/
```

---

# Phase F22 — Parent Portal

> **Route Group:** `app/(portals)/parent`

---

## Modules

- Parent Dashboard
- Student Overview
- Attendance
- Academic Progress
- Results
- Transcript
- Fee Status
- Payment History
- Timetable
- Assignments
- Notifications
- Certificates

---

## Pages

```
parent/
├── dashboard/
├── student/
├── attendance/
├── results/
├── transcript/
├── fees/
├── timetable/
├── assignments/
├── certificates/
└── notifications/
```

---

# Phase F23 — Reports & Analytics

> **Route Group:** `app/(university)/reports`

---

## Modules

- Academic Dashboard
- Student Analytics
- Faculty Analytics
- Department Analytics
- University Analytics
- Finance Reports
- Attendance Reports
- Examination Reports
- Result Reports
- Custom Reports
- Export Center

---

## Pages

```
reports/
├── dashboard/
├── students/
├── faculty/
├── departments/
├── university/
├── finance/
├── attendance/
├── examinations/
├── results/
└── exports/
```

---

# Phase F24 — Notifications & Communication

> **Route Group:** `app/(university)/communication`

---

## Modules

- Notification Center
- Announcements
- Broadcast Messages
- Email Templates
- SMS Templates
- Push Notifications
- Scheduled Notifications
- Notification History
- Communication Dashboard

---

## Pages

```
communication/
├── dashboard/
├── notifications/
├── announcements/
├── broadcasts/
├── email/
├── sms/
├── push/
├── scheduled/
└── history/
```

---

# Phase F25 — System Settings & Administration

> **Route Group:** `app/(university)/settings`

---

## Modules

- University Settings
- Campus Settings
- Branding
- Academic Settings
- Finance Settings
- Examination Settings
- Users
- Roles
- Permissions
- Audit Logs
- API Keys
- Integrations
- Email Configuration
- SMS Configuration
- Storage Configuration
- Backup & Restore
- Security Settings
- Profile Settings

---

## Pages

```
settings/
├── page.tsx
├── university/
├── campus/
├── branding/
├── academic/
├── finance/
├── examinations/
├── users/
├── roles/
├── permissions/
├── audit/
├── api-keys/
├── integrations/
├── email/
├── sms/
├── storage/
├── backup/
├── security/
└── profile/

```
## File Structure for Dharmesh

```
app/
├── (auth)/
│   ├── layout.tsx
│   ├── login/page.tsx
│   ├── forgot-password/page.tsx
│   └── reset-password/page.tsx
│
├── (platform)/
│   ├── layout.tsx
│   ├── dashboard/page.tsx
│   ├── tenants/
│   │   ├── page.tsx
│   │   └── [id]/page.tsx
│   └── subscriptions/page.tsx
│
├── (university)/
│   ├── layout.tsx
│   ├── dashboard/page.tsx
│   │
│   ├── setup/
│   │   ├── campuses/
│   │   ├── schools/
│   │   ├── departments/
│   │   ├── programmes/
│   │   └── specialisations/
│   │
│   ├── calendar/
│   │   ├── academic-years/
│   │   ├── semesters/
│   │   ├── batches/
│   │   └── sections/
│   │
│   ├── users/
│   │   ├── page.tsx
│   │   ├── [id]/page.tsx
│   │   └── roles/
│   │
│   ├── students/
│   │   ├── page.tsx
│   │   └── [id]/
│   │
│   ├── faculty/
│   │   ├── page.tsx
│   │   └── [id]/
│   │
│   ├── employees/
│   │
│   ├── curriculum/
│   │   ├── courses/
│   │   └── [id]/
│   │
│   ├── timetable/
│   │
│   ├── attendance/
│   │   ├── mark/
│   │   └── report/
│   │
│   ├── finance/
│   │   ├── fee-structures/
│   │   ├── fee-demands/
│   │   └── report/
│   │
│   ├── certificates/
│   │   ├── templates/
│   │   └── issue/
│   │
│   ├── evaluation/                         ← Phase F14
│   │   ├── page.tsx
│   │   ├── grade-scales/
│   │   │   ├── page.tsx
│   │   │   ├── new/
│   │   │   └── [id]/
│   │   │
│   │   ├── schemes/
│   │   │   ├── page.tsx
│   │   │   ├── new/
│   │   │   └── [id]/
│   │   │       ├── page.tsx
│   │   │       ├── edit/
│   │   │       ├── versions/
│   │   │       ├── components/
│   │   │       ├── rules/
│   │   │       └── passing-criteria/
│   │   │
│   │   ├── course-registrations/
│   │   ├── assessment-events/
│   │   ├── results/
│   │   │   ├── internal/
│   │   │   ├── external/
│   │   │   ├── student/
│   │   │   └── semester/
│   │   │
│   │   ├── analytics/
│   │   └── transcript/
│   │
│   ├── examinations/                       ← Phase F18
│   │   ├── page.tsx
│   │   ├── schedule/
│   │   ├── sessions/
│   │   ├── halls/
│   │   ├── seating/
│   │   ├── invigilators/
│   │   ├── admit-cards/
│   │   ├── notices/
│   │   └── practicals/
│   │
│   ├── reports/                            ← Phase F23
│   │   ├── dashboard/
│   │   ├── students/
│   │   ├── faculty/
│   │   ├── departments/
│   │   ├── university/
│   │   ├── finance/
│   │   ├── attendance/
│   │   ├── examinations/
│   │   ├── results/
│   │   └── exports/
│   │
│   ├── communication/                      ← Phase F24
│   │   ├── dashboard/
│   │   ├── notifications/
│   │   ├── announcements/
│   │   ├── broadcasts/
│   │   ├── email/
│   │   ├── sms/
│   │   ├── push/
│   │   ├── scheduled/
│   │   └── history/
│   │
│   └── settings/                           ← Phase F25
│       ├── page.tsx
│       ├── university/
│       ├── campus/
│       ├── branding/
│       ├── academic/
│       ├── finance/
│       ├── examinations/
│       ├── users/
│       ├── roles/
│       ├── permissions/
│       ├── audit/
│       ├── api-keys/
│       ├── integrations/
│       ├── email/
│       ├── sms/
│       ├── storage/
│       ├── backup/
│       ├── security/
│       └── profile/
│
├── (portals)/
│   ├── student/                            ← Phase F20
│   │   ├── layout.tsx
│   │   ├── dashboard/
│   │   ├── profile/
│   │   ├── courses/
│   │   ├── registrations/
│   │   ├── timetable/
│   │   ├── attendance/
│   │   ├── assignments/
│   │   ├── results/
│   │   ├── transcript/
│   │   ├── fees/
│   │   ├── certificates/
│   │   ├── notifications/
│   │   └── calendar/
│   │
│   ├── faculty/                            ← Phase F21
│   │   ├── layout.tsx
│   │   ├── dashboard/
│   │   ├── courses/
│   │   ├── timetable/
│   │   ├── attendance/
│   │   ├── assignments/
│   │   ├── marks/
│   │   ├── assessments/
│   │   ├── analytics/
│   │   ├── examinations/
│   │   └── notifications/
│   │
│   └── parent/                             ← Phase F22
│       ├── layout.tsx
│       ├── dashboard/
│       ├── student/
│       ├── attendance/
│       ├── results/
│       ├── transcript/
│       ├── fees/
│       ├── timetable/
│       ├── assignments/
│       ├── certificates/
│       └── notifications/
│
├── (public)/
│   └── verify/
│       └── [certNo]/
│
├── api/
└── globals.css

components/
├── ui/
├── layout/
├── forms/
├── tables/
├── charts/
├── evaluation/                             ← Phase F14
├── examination/                            ← Phase F18
├── finance/
├── attendance/
├── reports/                                ← Phase F23
├── communication/                          ← Phase F24
├── settings/                               ← Phase F25
├── student-portal/                         ← Phase F20
├── faculty-portal/                         ← Phase F21
└── parent-portal/                          ← Phase F22

lib/
├── api/
├── auth/
├── hooks/
├── utils/
├── validations/
├── constants/
└── types/
```
---

## Build Order for Dharmesh

Build strictly in sequence. Do **NOT** skip phases. Do **NOT** start a phase until all pages, layouts, components, forms, validations and API integrations of the previous phase are completed and reviewed.

| Order | Phase | Scope | Depends On |
|-------|-------|-------|------------|
| 1 | F1 | Design System & Shared Components | None |
| 2 | F2 | Authentication | F1 |
| 3 | F3 | Platform Admin Portal | F1, F2 |
| 4 | F4 | University Setup & Academic Structure | F1–F3 |
| 5 | F5 | Users & RBAC | F1–F4 |
| 6 | F6 | Student Management | F1–F5 |
| 7 | F7 | Faculty & Employee Management | F1–F6 |
| 8 | F8 | Curriculum & Course Management | F1–F7 + Backend Phase 8 |
| 9 | F9 | Timetable & Attendance | F1–F8 + Backend Phase 9 |
| 10 | F10 | Finance & Fee Management | F1–F9 + Backend Phase 11 |
| 11 | F11 | Student Portal (Core) | F1–F10 |
| 12 | F12 | Faculty Portal (Core) | F1–F11 |
| 13 | F13 | Certificate Management | F1–F12 + Backend Certificate Module |
| 14 | F14 | Enterprise Academic Evaluation & Result Management | F1–F13 + Backend Phase 16 |
| 15 | F15 | UI Polish, Responsive Design, Accessibility & Reusable Components | F1–F14 |
| 16 | F16 | Performance Optimization & UX Enhancements | F1–F15 |
| 17 | F17 | Testing, Error Handling & Production Hardening | F1–F16 |
| 18 | F18 | Examination Management | F1–F17 + Backend Examination Module |
| 19 | F19 | Certificates & Documents | F1–F18 + Backend Certificate Module |
| 20 | F20 | Complete Student Portal | F1–F19 |
| 21 | F21 | Complete Faculty Portal | F1–F20 |
| 22 | F22 | Parent Portal | F1–F21 |
| 23 | F23 | Reports & Analytics | F1–F22 |
| 24 | F24 | Notifications & Communication | F1–F23 |
| 25 | F25 | System Settings & Administration | F1–F24 |

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
