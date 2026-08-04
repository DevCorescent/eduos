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

### Phase 2 — Platform / Super Admin ✅

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

### Phase 3 — Institutional Structure ✅

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

### Phase 4 — Academic Calendar ✅

| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/academic-years` | List / create academic years |
| GET/PATCH | `/api/academic-years/[id]` | Update, set as current |
| GET/POST | `/api/academic-years/[id]/semesters` | List / create semesters |
| GET/PATCH | `/api/semesters/[id]` | Update semester, set as current |
| GET/POST | `/api/batches` | List / create batches |
| GET/POST | `/api/batches/[id]/sections` | List / create sections |

---

### Phase 5 — Users & RBAC ✅

| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/users` | List users / invite user |
| GET/PATCH/DELETE | `/api/users/[id]` | Manage user |
| GET/POST | `/api/roles` | List / create roles |
| POST | `/api/users/[id]/roles` | Assign role to user |
| DELETE | `/api/users/[id]/roles/[roleId]` | Remove role |

---

### Phase 6 — Students ✅

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

### Phase 7 — Faculty & Staff ✅

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
# Future Roadmap (Phase 15+)

The following phases are proposed to transform eduOS into a complete Enterprise University ERP comparable to Oracle Campus Solutions, CAMU ERP and Academia ERP.

---

## Phase 15 — Smart Attendance Analytics

### Importance

Current attendance only stores records. This phase introduces attendance intelligence by helping students and faculty monitor attendance trends, predict shortages, and maintain the mandatory attendance criteria.

### Roles

- UNIVERSITY_ADMIN
- DEPARTMENT_HOD
- FACULTY
- STUDENT

### Features

- Overall Attendance
- Subject Wise Attendance
- Monthly Attendance
- Semester Attendance
- Attendance Graph
- Attendance Trend
- Classes Conducted
- Classes Attended
- Classes Missed
- Classes Required
- Classes Student Can Leave
- Attendance Prediction
- Attendance Alerts
- Low Attendance Notification

| Method | Route | Description |
|---|---|---|
| GET | `/api/attendance/analytics/[studentId]` | Complete attendance analytics |
| GET | `/api/attendance/leave-calculator/[studentId]` | Remaining classes student can miss |
| GET | `/api/attendance/prediction/[studentId]` | Attendance prediction |
| GET | `/api/attendance/subject-wise/[studentId]` | Subject-wise attendance |
| GET | `/api/attendance/dashboard` | Attendance dashboard |

---

## Phase 16 — Advanced Result Management

### Importance

Current examination module stores only examination results. This phase introduces complete semester-wise academic performance management.

### Roles

- UNIVERSITY_ADMIN
- DEPARTMENT_HOD
- FACULTY
- STUDENT
- PARENT

### Features

- ST1
- ST2
- PUT
- University Theory
- Practical
- Viva
- Attendance Marks
- Faculty Evaluation
- Internal Marks
- External Marks
- SGPA
- CGPA
- Grade Card
- Rank
- Result Analytics

| Method | Route | Description |
|---|---|---|
| GET | `/api/results/student/[studentId]` | Complete result |
| GET | `/api/results/semester/[semesterId]` | Semester result |
| GET | `/api/results/analytics/[studentId]` | Result analytics |
| POST | `/api/results/internal` | Upload internal marks |
| POST | `/api/results/external` | Upload external marks |
| GET | `/api/results/transcript/[studentId]` | Final transcript |

---

## Phase 17 — Student Finance Portal

### Importance

Students should be able to manage fee payments independently without administrative assistance.

### Roles

- STUDENT
- UNIVERSITY_ADMIN

### Features

- Payment History
- Pending Fees
- Receipt Download
- Receipt Preview
- QR Verification
- Scholarship
- Fine Details
- Payment Status

| Method | Route | Description |
|---|---|---|
| GET | `/api/fees/history` | Student payment history |
| GET | `/api/fees/receipts` | All receipts |
| GET | `/api/fees/receipt/[receiptId]` | Receipt details |
| GET | `/api/fees/download/[receiptId]` | Download receipt |
| GET | `/api/fees/pending` | Pending dues |

---

## Phase 18 — Student Profile Portal

### Importance

Creates a centralized student profile with academic and personal information.

### Roles

- STUDENT
- UNIVERSITY_ADMIN

### Features

- Professional Photograph
- Personal Details
- Academic Details
- Parent Details
- Documents
- Certificates
- Achievements
- Emergency Contacts

| Method | Route | Description |
|---|---|---|
| GET | `/api/student/profile` | Student profile |
| GET | `/api/student/dashboard` | Dashboard information |
| GET | `/api/student/achievements` | Student achievements |

---

## Phase 19 — Open Elective Management

### Importance

Allows departments to offer electives while enabling students to select courses according to eligibility and seat availability.

### Roles

- UNIVERSITY_ADMIN
- DEPARTMENT_HOD
- STUDENT

### Features

- Department Electives
- Branch Electives
- Preference Filling
- Seat Allocation
- Approval Workflow
- Locking
- Allocation Report

| Method | Route | Description |
|---|---|---|
| GET | `/api/open-electives` | Available electives |
| POST | `/api/open-electives/select` | Student preference |
| GET | `/api/open-electives/status` | Allocation status |
| POST | `/api/open-electives/allocate` | Allocate electives |
| PATCH | `/api/open-electives/lock` | Lock elective selection |

---

## Phase 20 — Faculty Feedback System

### Importance

Collects structured student feedback for continuous faculty improvement and institutional quality assessment.

### Roles

- STUDENT
- FACULTY
- DEPARTMENT_HOD
- UNIVERSITY_ADMIN

### Features

- Faculty Rating
- Lab Rating
- Anonymous Feedback
- Teaching Evaluation
- Behaviour
- Communication
- Practical Knowledge
- Infrastructure Rating

| Method | Route | Description |
|---|---|---|
| POST | `/api/feedback/faculty` | Submit faculty feedback |
| POST | `/api/feedback/lab` | Submit lab feedback |
| GET | `/api/feedback/faculty/[facultyId]` | Faculty analytics |
| GET | `/api/feedback/report` | Institution feedback report |
## File Structure
---

## Phase 21 — Student Permission System

### Importance

Students should have controlled access to the ERP. They must only be able to view their academic information, perform student-specific operations, and must never modify institutional records.

### Roles

- STUDENT

### Permissions

Students CAN

- View Dashboard
- View Attendance
- View Timetable
- View Results
- View Certificates
- View Assignments
- Submit Assignments
- Download Question Papers
- Download Solutions
- View Fee Ledger
- Download Receipts
- Fill Open Electives
- Submit Faculty Feedback
- View Notifications
- Update Limited Profile Information (Profile Photo, Contact Details if permitted)

Students CANNOT

- Modify Attendance
- Modify Marks
- Modify Internal Assessment
- Modify Timetable
- Modify Fees
- Modify Curriculum
- Modify Faculty Information

### APIs

| Method | Route | Description |
|---|---|---|
| GET | `/api/student/dashboard` | Student dashboard |
| GET | `/api/student/profile` | Student profile |
| GET | `/api/student/permissions` | Student permission matrix |

---

## Phase 22 — Attendance Lock & Audit System

### Importance

Attendance is a legal academic record. Once attendance is finalized, no faculty member should be able to modify it unless explicitly unlocked by the HOD.

### Roles

- DEPARTMENT_HOD
- FACULTY

### Features

- Lock Attendance
- Unlock Attendance
- Attendance Freeze
- Approval Workflow
- Audit History
- Faculty Notification
- Lock Status
- Semester Lock

### APIs

| Method | Route | Description |
|---|---|---|
| POST | `/api/attendance/lock` | Lock attendance |
| POST | `/api/attendance/unlock` | Unlock attendance |
| GET | `/api/attendance/lock-status` | Attendance lock status |
| GET | `/api/attendance/audit` | Attendance audit history |

---

## Phase 23 — Faculty Profile & Performance Analytics

### Importance

Maintains complete faculty profiles while providing institutional analytics on teaching performance, workload, and student feedback.

### Roles

- UNIVERSITY_ADMIN
- DEPARTMENT_HOD
- FACULTY

### Features

- Professional Photo
- Faculty Number
- Qualification
- Designation
- Department
- Experience
- Research Publications
- Certifications
- Education History
- Subjects Teaching
- Weekly Timetable
- Lecture Count
- Student Count
- Feedback Rating
- Teaching Performance
- Attendance Statistics
- Result Analytics
- Dashboard Charts

### APIs

| Method | Route | Description |
|---|---|---|
| GET | `/api/faculty/profile/[facultyId]` | Faculty profile |
| PATCH | `/api/faculty/profile/[facultyId]` | Update profile |
| GET | `/api/faculty/performance/[facultyId]` | Performance dashboard |
| GET | `/api/faculty/workload/[facultyId]` | Teaching workload |
| GET | `/api/faculty/analytics/[facultyId]` | Faculty analytics |

---

## Phase 24 — Assignment Management Enhancement

### Importance

Provides complete assignment lifecycle management including creation, submission, evaluation, grading, reminders, and analytics.

### Roles

- FACULTY
- STUDENT

### Features

Faculty

- Create Assignment
- Publish Assignment
- Edit Assignment
- Delete Assignment
- View Submitted Students
- View Pending Students
- Grade Assignment
- Add Feedback
- Assignment Analytics

Student

- Assignment List
- Upload Submission
- Resubmit
- Submission History
- View Marks
- Faculty Feedback

### APIs

| Method | Route | Description |
|---|---|---|
| POST | `/api/assignments` | Create assignment |
| PATCH | `/api/assignments/[id]` | Update assignment |
| DELETE | `/api/assignments/[id]` | Delete assignment |
| GET | `/api/assignments/[id]/pending` | Pending students |
| GET | `/api/assignments/[id]/submitted` | Submitted students |
| POST | `/api/assignments/[id]/submit` | Student submission |
| PATCH | `/api/assignments/[id]/grade` | Grade assignment |
| GET | `/api/assignments/analytics` | Assignment analytics |

---

## Phase 25 — AI Assisted Internal Assessment

### Importance

Assists faculty in awarding fair internal marks using attendance, assignments, quizzes, practical work, and previous academic performance while keeping the final decision with the faculty.

### Roles

- FACULTY
- DEPARTMENT_HOD
- UNIVERSITY_ADMIN

### Features

- Suggested Internal Marks
- Attendance Analysis
- Assignment Analysis
- Quiz Analysis
- Practical Analysis
- AI Recommendation
- Confidence Score
- Faculty Override
- Remarks
- Audit Trail

> Internal marking rules are configured by the university. Faculty can override AI suggestions within the allowed range.

### APIs

| Method | Route | Description |
|---|---|---|
| POST | `/api/internal-assessment/generate` | Generate AI suggestions |
| GET | `/api/internal-assessment/student/[studentId]` | Student internal marks |
| PATCH | `/api/internal-assessment/[studentId]` | Faculty update |
| GET | `/api/internal-assessment/audit/[studentId]` | Audit history |
| GET | `/api/internal-assessment/rules` | University marking rules |

---

## Phase 26 — Question Paper & Solution Repository

### Importance

Provides a centralized digital repository for question papers, official solutions, marking schemes, and previous year papers. It helps students prepare effectively while giving faculty a structured platform for publishing examination resources.

### Roles

- UNIVERSITY_ADMIN
- DEPARTMENT_HOD
- FACULTY
- STUDENT

### Features

Faculty

- Upload Question Paper
- Upload Official Solution
- Upload Marking Scheme
- Upload Answer Key
- Upload Reference Material
- Upload Formula Sheet
- Draft Mode
- Publish Immediately
- Schedule Publish
- Archive Resources

Student

- View Question Papers
- Download Question Papers
- View Official Solutions
- Download Solutions
- Download Marking Scheme
- Previous Year Question Papers
- Resource Search
- Semester-wise Resources
- Subject-wise Resources

HOD

- View Uploaded Resources
- Verify Uploads
- Publish/Unpublish
- Department Repository

### APIs

| Method | Route | Description |
|---|---|---|
| POST | `/api/exam-resources` | Upload examination resource |
| GET | `/api/exam-resources` | List resources |
| GET | `/api/exam-resources/[id]` | Resource details |
| PATCH | `/api/exam-resources/[id]` | Update resource |
| DELETE | `/api/exam-resources/[id]` | Delete resource |
| GET | `/api/students/me/exam-resources` | Student resource list |
| GET | `/api/students/me/exam-resources/[id]` | View resource |
| GET | `/api/students/me/exam-resources/[id]/download` | Download resource |
| PATCH | `/api/exam-resources/[id]/publish` | Publish resource |
| PATCH | `/api/exam-resources/[id]/archive` | Archive resource |

---

## Phase 27 — Notification Center & Announcement System

### Importance

Creates a centralized communication platform for all users. Real-time notifications ensure students, faculty, HODs, and administrators receive timely updates about academic, financial, and administrative events.

### Roles

- SUPER_ADMIN
- UNIVERSITY_ADMIN
- CAMPUS_ADMIN
- DEPARTMENT_HOD
- FACULTY
- STUDENT
- PARENT

### Features

Notification Bell

- Unread Count
- Read/Unread Status
- Notification Drawer
- Mark as Read
- Mark All Read
- Delete Notification
- Archive Notification

Notification Categories

- Academic
- Attendance
- Assignments
- Results
- Fees
- Certificates
- Timetable
- AI
- Finance
- General Announcement
- Emergency Alerts

Announcement System

- Institution-wide Announcements
- Department Announcements
- Batch Announcements
- Section Announcements
- Scheduled Announcements
- Pinned Announcements

Student Notifications

- Attendance Updated
- Attendance Below 75%
- Assignment Published
- Assignment Deadline
- Assignment Evaluated
- Fee Demand Generated
- Payment Successful
- Receipt Generated
- Result Published
- Certificate Issued
- Open Elective Window
- Timetable Updated
- New Study Material
- Question Paper Uploaded
- Solution Uploaded

Faculty Notifications

- Attendance Lock
- Attendance Unlock
- Assignment Submission
- Internal Marks Reminder
- Student Feedback
- Timetable Updated
- HOD Announcement
- Exam Duty
- Paper Upload Reminder

Administration Notifications

- New Admission
- Pending Approval
- Fee Collection Summary
- Daily ERP Report
- Department Analytics

### APIs

| Method | Route | Description |
|---|---|---|
| GET | `/api/notifications` | Notification list |
| GET | `/api/notifications/unread` | Unread notifications |
| PATCH | `/api/notifications/[id]/read` | Mark notification as read |
| PATCH | `/api/notifications/read-all` | Mark all notifications as read |
| DELETE | `/api/notifications/[id]` | Delete notification |
| POST | `/api/announcements` | Create announcement |
| GET | `/api/announcements` | List announcements |
| GET | `/api/announcements/[id]` | Announcement details |
| PATCH | `/api/announcements/[id]` | Update announcement |
| DELETE | `/api/announcements/[id]` | Delete announcement |

---

# Enterprise Expansion Roadmap

The following modules are recommended after completion of the academic ERP to transform eduOS into a comprehensive university management platform.

| Phase | Module | Priority |
|-------|--------|----------|
| Phase 28 | Hostel Management | Medium |
| Phase 29 | Library Management | Medium |
| Phase 30 | Transport Management | Medium |
| Phase 31 | Placement & Training Cell | High |
| Phase 32 | Alumni Portal | Medium |
| Phase 33 | Research & Innovation Portal | Medium |
| Phase 34 | Event & Club Management | Medium |
| Phase 35 | Leave Management System | Medium |
| Phase 36 | Asset & Inventory Management | Medium |
| Phase 37 | Visitor & Gate Pass Management | Medium |
| Phase 38 | Mobile Application (Android & iOS) | High |
| Phase 39 | Executive Analytics & BI Dashboard | High |

---

# Updated Project Statistics

| Category | Count |
|-----------|------:|
| Completed Backend Phases | **14** |
| Planned Core ERP Phases | **13** |
| Enterprise Expansion Phases | **12** |
| **Total Planned Phases** | **39** |
| Approximate Backend APIs | **160+** |
| Supported User Roles | **7** |
| Multi-Tenant Architecture | ✅ |
| AI Integration | ✅ |
| Enterprise Ready | ✅ |

---

# Supported Roles

- SUPER_ADMIN
- UNIVERSITY_ADMIN
- CAMPUS_ADMIN
- DEPARTMENT_HOD
- FACULTY
- STUDENT
- PARENT

---

# Future Integrations

- Razorpay Payment Gateway
- SMS Gateway
- WhatsApp Notifications
- Mobile Push Notifications
- WebSocket Real-Time Updates
- AI Academic Advisor
- AI Attendance Prediction
- AI Student Performance Prediction
- AI Course Recommendation
- AI Placement Recommendation
- AI Chat Assistant
- AI Report Generator
- Learning Analytics
- Business Intelligence Dashboard

---

# Project Goal

Build **eduOS** into a complete **Enterprise Multi-University ERP** that manages the full academic lifecycle—from admissions and curriculum to examinations, finance, AI-assisted learning, analytics, and institutional administration—through a secure, scalable, and modern SaaS platform.
---

## Folder Structure (Updated)

```text
eduos/
├── app/
│   ├── (auth)/
│   ├── (platform)/
│   ├── (university)/
│   ├── (faculty)/
│   ├── (student)/
│   ├── api/
│   │
│   ├── auth/
│   ├── platform/
│   ├── campuses/
│   ├── schools/
│   ├── departments/
│   ├── programmes/
│   ├── academic-years/
│   ├── semesters/
│   ├── batches/
│   ├── sections/
│   ├── users/
│   ├── roles/
│   ├── students/
│   ├── parents/
│   ├── faculty/
│   ├── employees/
│   ├── courses/
│   ├── curricula/
│   ├── timetables/
│   ├── attendance/
│   ├── assignments/
│   ├── examinations/
│   ├── results/
│   ├── fee-structures/
│   ├── fee-demands/
│   ├── finance/
│   ├── certificates/
│   ├── certificate-templates/
│   ├── notifications/
│   ├── notification-templates/
│   ├── announcements/
│   ├── ai/
│   ├── open-electives/
│   ├── feedback/
│   ├── internal-assessment/
│   ├── exam-resources/
│   └── analytics/
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── lib/
│   ├── auth/
│   ├── db/
│   ├── middleware/
│   ├── validations/
│   ├── services/
│   ├── utils/
│   └── ai/
│
├── types/
├── actions/
├── services/
├── utils/
├── components/
├── hooks/
└── public/
```

---

# Complete Module Coverage

| Module | Status |
|---------|:------:|
| Authentication | ✅ |
| Platform Management | ✅ |
| Campus Management | ✅ |
| School Management | ✅ |
| Department Management | ✅ |
| Programme Management | ✅ |
| Academic Calendar | ✅ |
| Users & RBAC | ✅ |
| Students | ✅ |
| Faculty | ✅ |
| Employees | ✅ |
| Curriculum | ✅ |
| Courses | ✅ |
| Timetable | ✅ |
| Attendance | ✅ |
| Assignments | ✅ |
| Examination | ✅ |
| Results | ✅ |
| Finance | ✅ |
| Certificates | ✅ |
| Notifications | ✅ |
| AI | ✅ |
| Attendance Analytics | 🚧 |
| Student Dashboard | 🚧 |
| Result Analytics | 🚧 |
| Open Electives | 🚧 |
| Faculty Feedback | 🚧 |
| Internal Assessment | 🚧 |
| Question Repository | 🚧 |
| Notification Center | 🚧 |

---

# Estimated Backend APIs

| Module | APIs |
|----------|----:|
| Authentication | 6 |
| Platform | 7 |
| Institution | 14 |
| Academic Calendar | 8 |
| Users | 5 |
| Students | 8 |
| Faculty | 5 |
| Curriculum | 6 |
| Attendance | 8 |
| Timetable | 4 |
| Assignments | 8 |
| Examination | 6 |
| Finance | 7 |
| Certificates | 6 |
| Notifications | 6 |
| AI | 3 |
| Attendance Analytics | 5 |
| Results | 6 |
| Open Electives | 5 |
| Faculty Feedback | 4 |
| Student Dashboard | 3 |
| Internal Assessment | 5 |
| Question Repository | 9 |
| Notification Center | 10 |

### Total Planned APIs

**≈ 170+ REST APIs**

---

# Security Features

- Multi-Tenant Isolation
- JWT Authentication
- Refresh Token Rotation
- Session Management
- RBAC
- Scope Based Authorization
- Tenant Resolution
- Audit Logging
- Input Validation (Zod)
- Rate Limiting (Future)
- CSRF Protection
- HTTP Only Cookies
- Secure Password Hashing
- Cloud Storage Access Control

---

# Development Standards

Every backend phase must satisfy the following before merge:

- Feature Complete
- APIs Implemented
- Authentication Implemented
- Authorization Implemented
- Validation Implemented
- Tenant Isolation Verified
- Unit Tests Passed
- Integration Tests Passed
- TypeScript Clean
- ESLint Clean
- Production Build Successful
- API Documentation Updated
- Postman Collection Updated

---

# Coding Standards

- TypeScript Strict Mode
- Prisma Best Practices
- Repository Pattern
- Service Layer Architecture
- Reusable Validation
- Shared Response Envelope
- No Business Logic in Routes
- Proper Error Handling
- Audit Logging
- Environment Variable Driven Configuration

---

# API Response Standard

## Success

```json
{
  "success": true,
  "data": {},
  "message": "Success"
}
```

## Error

```json
{
  "success": false,
  "error": "Something went wrong",
  "code": "SERVER_ERROR"
}
```

---

# Common Error Codes

- VALIDATION_ERROR
- UNAUTHORIZED
- FORBIDDEN
- NOT_FOUND
- CONFLICT
- SERVER_ERROR
- PROVIDER_ERROR
- PROVIDER_TIMEOUT

---

# Setup

```bash
# Install dependencies
npm install

# Generate Prisma Client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Seed demo data
npm run seed

# Start development server
npm run dev
```

---

# Production Checklist

- Environment variables configured
- Prisma migrations applied
- Database seeded
- SMTP configured
- Cloudflare R2 configured
- Groq API configured
- HTTPS enabled
- Cookies marked Secure
- Rate limiting enabled
- Monitoring configured
- Backup strategy configured

---

# Long-Term Vision

eduOS aims to become a complete **Enterprise Multi-University ERP** that supports:

- Academic Administration
- Student Information System (SIS)
- Learning Management
- Finance & Fee Management
- Faculty Management
- AI-Powered Learning
- Examination Automation
- Attendance Intelligence
- Digital Certificates
- Notification & Communication
- Analytics & Business Intelligence
- Multi-Tenant SaaS Deployment

---

# Current Progress

| Metric | Value |
|--------|------:|
| Backend Phases Completed | **14 / 27** |
| Future Enterprise Phases | **12** |
| Total Planned Phases | **39** |
| Approximate Backend APIs | **170+** |
| User Roles Supported | **7** |
| Technology Stack | **Next.js + Prisma + Neon + Groq** |
| Architecture | **Multi-Tenant SaaS** |
| Status | **Production Ready Core, Enterprise Expansion Planned** |```
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
