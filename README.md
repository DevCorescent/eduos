# eduOS — Multi-University Management Platform

Full-stack SaaS for managing universities, e-learning, attendance, fees, and certifications.  
Built with **Next.js 16**, **Prisma 7**, **Neon PostgreSQL**, **Tailwind CSS v4**.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.2 (App Router, full-stack) |
| Database | Neon DB (serverless PostgreSQL) |
| ORM | Prisma 7 |
| Auth | JWT (httpOnly cookies) + DB Sessions |
| Styling | Tailwind CSS v4 |
| Validation | Zod |
| Email | SMTP (Hostinger) |
| Storage | Cloudflare R2 |
| AI | Groq API |
| Language | TypeScript |

---

## Multi-Auth System

eduOS has **5 actor types**, each with different access scope:

```
Platform Level
└── SUPER_ADMIN       — manages all tenants, subscriptions, billing

Tenant (University) Level
├── UNIVERSITY_ADMIN  — full access to their university
├── CAMPUS_ADMIN      — scoped to one campus
└── DEPARTMENT_HOD    — scoped to one department

User Level
├── FACULTY           — courses, attendance, grades, assignments
├── STUDENT           — own profile, attendance, grades, fees
└── PARENT            — view-only access to linked child's data
```

### How auth works

1. User POSTs `{ tenantSlug, email, password }` to `/api/auth/login`
2. Server validates credentials, issues **access token** (7d) + **refresh token** (30d) as httpOnly cookies
3. Every protected API reads the `edu_access` cookie → verifies JWT → extracts `{ sub, tenantId, roles }`
4. Route middleware checks role & scope before allowing access
5. Refresh token auto-rotates the access token via `/api/auth/refresh`

---

## Backend Build Plan

We build backend-first, module by module. Each phase ships working APIs before moving on.

---

### Phase 1 — Auth ✅

| Method | Route | Description |
|---|---|---|
| POST | `/api/auth/login` | Login with tenantSlug + email + password |
| POST | `/api/auth/logout` | Clear session cookies |
| GET | `/api/auth/me` | Get current user profile |
| POST | `/api/auth/refresh` | Rotate access token using refresh cookie |
| POST | `/api/auth/forgot-password` | Send reset OTP via email |
| POST | `/api/auth/reset-password` | Confirm OTP and set new password |

---

### Phase 2 — Platform / Super Admin

Manage tenants from the platform level. Only `SUPER_ADMIN` can access.

| Method | Route | Description |
|---|---|---|
| GET | `/api/platform/tenants` | List all tenants (paginated) |
| POST | `/api/platform/tenants` | Onboard a new university |
| GET | `/api/platform/tenants/[id]` | Get tenant details |
| PATCH | `/api/platform/tenants/[id]` | Update tenant info / status |
| GET | `/api/platform/tenants/[id]/stats` | Student / faculty / revenue stats |
| GET | `/api/platform/subscriptions` | List all subscriptions |
| PATCH | `/api/platform/subscriptions/[id]` | Change plan / status |

---

### Phase 3 — Institutional Structure

Hierarchy: Campus → School → Department → Programme → Specialisation

| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/campuses` | List / create campuses |
| GET/PATCH/DELETE | `/api/campuses/[id]` | Manage campus |
| GET/POST | `/api/schools` | List / create schools |
| GET/PATCH/DELETE | `/api/schools/[id]` | Manage school |
| GET/POST | `/api/departments` | List / create departments |
| GET/PATCH/DELETE | `/api/departments/[id]` | Manage department |
| GET/POST | `/api/programmes` | List / create programmes |
| GET/PATCH/DELETE | `/api/programmes/[id]` | Manage programme |
| GET/POST | `/api/programmes/[id]/specialisations` | Manage specialisations |

---

### Phase 4 — Academic Calendar

| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/academic-years` | List / create academic years |
| GET/PATCH | `/api/academic-years/[id]` | Update, set as current |
| GET/POST | `/api/academic-years/[id]/semesters` | List / create semesters |
| GET/PATCH | `/api/semesters/[id]` | Update semester, set as current |
| GET/POST | `/api/batches` | List / create batches |
| GET/POST | `/api/batches/[id]/sections` | List / create sections |

---

### Phase 5 — Users & RBAC

| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/users` | List users / invite user |
| GET/PATCH/DELETE | `/api/users/[id]` | Manage user |
| GET/POST | `/api/roles` | List / create roles |
| POST | `/api/users/[id]/roles` | Assign role to user |
| DELETE | `/api/users/[id]/roles/[roleId]` | Remove role |

---

### Phase 6 — Students

| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/students` | List / enroll student |
| GET/PATCH | `/api/students/[id]` | Get / update student |
| GET/PUT | `/api/students/[id]/personal` | Personal info (DOB, address etc.) |
| GET/POST | `/api/students/[id]/documents` | Upload / list documents |
| DELETE | `/api/students/[id]/documents/[docId]` | Remove document |
| GET/POST | `/api/students/[id]/parents` | List / link parents |
| POST | `/api/parents` | Create parent record |
| GET | `/api/students/[id]/transcript` | Full academic transcript |

---

### Phase 7 — Faculty & Staff

| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/faculty` | List / create faculty |
| GET/PATCH | `/api/faculty/[id]` | Get / update faculty |
| GET/POST | `/api/faculty/[id]/assignments` | Course assignments |
| GET/POST | `/api/employees` | Non-teaching staff |
| GET/PATCH | `/api/employees/[id]` | Manage employee |

---

### Phase 8 — Curriculum & Courses

| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/courses` | List / create courses |
| GET/PATCH | `/api/courses/[id]` | Manage course |
| GET/POST | `/api/curricula` | List / create curriculum versions |
| GET | `/api/curricula/[id]` | Curriculum with all subjects |
| POST | `/api/curricula/[id]/subjects` | Add course to curriculum |
| DELETE | `/api/curricula/[id]/subjects/[subjectId]` | Remove subject |

---

### Phase 9 — Timetable & Attendance

| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/timetables` | List / create timetable entries |
| DELETE | `/api/timetables/[id]` | Remove slot |
| GET | `/api/timetables/section/[sectionId]` | Full section timetable |
| GET | `/api/timetables/faculty/[facultyId]` | Faculty schedule |
| POST | `/api/attendance` | Mark attendance (bulk) |
| GET | `/api/attendance` | Query attendance (student / section / date) |
| PATCH | `/api/attendance/[id]` | Correct a record |
| GET | `/api/attendance/report/[studentId]` | Attendance % per course |

---

### Phase 10 — Assessments

| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/assignments` | List / create assignments |
| GET/PATCH | `/api/assignments/[id]` | Manage assignment |
| POST | `/api/assignments/[id]/publish` | Publish to students |
| GET/POST | `/api/assignments/[id]/submissions` | List / submit |
| PATCH | `/api/assignments/[id]/submissions/[sid]` | Grade submission |
| GET/POST | `/api/examinations` | List / schedule exam |
| GET/PATCH | `/api/examinations/[id]` | Manage exam |
| POST | `/api/examinations/[id]/results` | Bulk upload results |
| GET | `/api/examinations/[id]/results` | List results |
| GET | `/api/students/[id]/results` | All results for a student |

---

### Phase 11 — Finance

> Payment gateway deferred — Razorpay will be added later.

| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/fee-structures` | List / create fee structures |
| GET/PATCH | `/api/fee-structures/[id]` | Manage structure + components |
| POST | `/api/fee-demands/generate` | Generate demands for a batch/semester |
| GET | `/api/fee-demands` | List demands (filter by student/semester) |
| PATCH | `/api/fee-demands/[id]/waive` | Apply waiver |
| GET | `/api/students/[id]/fee-demands` | Student's fee ledger |
| GET | `/api/finance/report` | Collection report by programme/semester |

---

### Phase 12 — Certificates

| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/certificate-templates` | List / create HTML templates |
| GET/PATCH | `/api/certificate-templates/[id]` | Manage template |
| POST | `/api/certificates/issue` | Issue certificate to student |
| GET | `/api/certificates/verify/[certNo]` | Public verification by cert number |
| GET | `/api/students/[id]/certificates` | Student's certificates |
| POST | `/api/certificates/[id]/revoke` | Revoke certificate |

---

### Phase 13 — Email Notifications

> SMS deferred.

| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/notification-templates` | List / create email templates |
| POST | `/api/notifications/send` | Send email to a user or group |
| GET | `/api/notifications` | List sent notifications |

---

### Phase 14 — AI (Groq)

| Method | Route | Description |
|---|---|---|
| POST | `/api/ai/ask` | General Q&A for students/faculty |
| POST | `/api/ai/summarise` | Summarise course material |
| POST | `/api/ai/generate-questions` | Generate quiz from content |

---

## File Structure

```
eduos/
├── app/
│   ├── (auth)/                   # Login, forgot-password pages
│   ├── (platform)/               # Super admin UI
│   ├── (university)/             # University admin UI
│   ├── (portals)/                # Student / Faculty portals
│   ├── api/
│   │   ├── auth/                 # login, logout, me, refresh, forgot-password, reset-password
│   │   ├── platform/             # tenants, subscriptions (SUPER_ADMIN only)
│   │   ├── campuses/
│   │   ├── schools/
│   │   ├── departments/
│   │   ├── programmes/
│   │   ├── academic-years/
│   │   ├── semesters/
│   │   ├── batches/
│   │   ├── users/
│   │   ├── roles/
│   │   ├── students/
│   │   ├── parents/
│   │   ├── faculty/
│   │   ├── employees/
│   │   ├── courses/
│   │   ├── curricula/
│   │   ├── timetables/
│   │   ├── attendance/
│   │   ├── assignments/
│   │   ├── examinations/
│   │   ├── fee-structures/
│   │   ├── fee-demands/
│   │   ├── finance/
│   │   ├── certificate-templates/
│   │   ├── certificates/
│   │   ├── notification-templates/
│   │   ├── notifications/
│   │   └── ai/
│   └── generated/prisma/         # Auto-generated Prisma client
├── lib/
│   ├── db/prisma.ts              # Prisma singleton
│   ├── auth/                     # jwt.ts, password.ts, session.ts
│   ├── validations/              # Zod schemas per module
│   ├── services/                 # Business logic
│   └── middleware/               # requireRole, requireTenant helpers
├── types/                        # Shared TypeScript types
├── prisma/
│   ├── schema.prisma             # Full 35-model schema
│   └── migrations/
└── .env
```

---

## API Response Format

All APIs return a consistent envelope:

```ts
// Success
{ "success": true, "data": <T>, "message"?: string }

// Error
{ "success": false, "error": string, "code"?: string }
```

Common error codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `SERVER_ERROR`

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Run migrations against Neon DB
npx prisma migrate dev --name init

# 3. Start dev server
npm run dev
```
