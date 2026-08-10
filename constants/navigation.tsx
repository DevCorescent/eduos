// ============================================================================
// MODULE : Constants — Portal Navigation
// PURPOSE: The sidebar tree for each of the four portals, declared as data.
//
//          Navigation is data rather than JSX inside each layout so that three
//          things derive from one source: the rendered sidebar, the role gate
//          on each link, and the breadcrumb trail (PortalBreadcrumb resolves a
//          URL segment to a label through NAV_LABELS, built from these entries).
//          Hand-writing a second breadcrumb map is exactly how a renamed link
//          ends up with a stale trail.
//
//          Role gating here is presentation only — it decides what a user is
//          shown. It is not access control: the API enforces that per request
//          via requireRole, and the portal layouts redirect on top of it.
// ============================================================================

import {
  Award,
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  CreditCard,
  FileText,
  Flag,
  GraduationCap,
  Hash,
  LayoutDashboard,
  Library,
  MessageSquare,
  Receipt,
  School,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import type { SidebarSection } from "@/components/layout/Sidebar";
import { ROLES, UNIVERSITY_ROLES } from "./roles";

/**
 * A nav entry before role filtering.
 *
 * `roles` omitted means "everyone in this portal" — the portal's own layout
 * guard has already established who that is, so most entries need no gate.
 */
export interface NavEntry {
  label: string;
  href: string;
  icon: React.ReactNode;
  roles?: readonly string[];
}

export interface NavGroup {
  label?: string;
  items: NavEntry[];
}

// Sized here rather than at each usage so every icon in the tree matches.
const iconClass = "size-5";

// --- Platform Admin ---------------------------------------------------------

export const PLATFORM_NAV: NavGroup[] = [
  {
    items: [
      { label: "Dashboard", href: "/platform/dashboard", icon: <LayoutDashboard className={iconClass} /> },
      { label: "Tenants", href: "/platform/tenants", icon: <Building2 className={iconClass} /> },
      // W1.3. "Platform Users" rather than "Users": the University portal has a
      // Users screen of its own, and the breadcrumb map below is built from
      // these labels, so two entries called "Users" would produce two trails
      // that read identically for entirely different people.
      { label: "Platform Users", href: "/platform/users", icon: <ShieldCheck className={iconClass} /> },
      { label: "Subscriptions", href: "/platform/subscriptions", icon: <CreditCard className={iconClass} /> },
      { label: "Feature Flags", href: "/platform/feature-flags", icon: <Flag className={iconClass} /> },
    ],
  },
];

// --- University Admin -------------------------------------------------------

export const UNIVERSITY_NAV: NavGroup[] = [
  {
    items: [{ label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard className={iconClass} /> }],
  },
  {
    label: "Setup",
    items: [
      { label: "Campuses", href: "/setup/campuses", icon: <Building2 className={iconClass} /> },
      { label: "Schools", href: "/setup/schools", icon: <School className={iconClass} /> },
      { label: "Departments", href: "/setup/departments", icon: <Library className={iconClass} /> },
      { label: "Programmes", href: "/setup/programmes", icon: <GraduationCap className={iconClass} /> },
      { label: "Identifiers", href: "/setup/identifiers", icon: <Hash className={iconClass} /> },
    ],
  },
  {
    label: "Academic Calendar",
    items: [
      { label: "Academic Years", href: "/calendar/academic-years", icon: <CalendarRange className={iconClass} /> },
      { label: "Batches", href: "/calendar/batches", icon: <CalendarDays className={iconClass} /> },
    ],
  },
  {
    label: "People",
    items: [
      { label: "Students", href: "/students", icon: <Users className={iconClass} /> },
      { label: "Faculty", href: "/faculty", icon: <UserCog className={iconClass} /> },
      { label: "Employees", href: "/employees", icon: <Users className={iconClass} /> },
    ],
  },
  {
    label: "Academics",
    items: [
      { label: "Courses", href: "/curriculum/courses", icon: <BookOpen className={iconClass} /> },
      { label: "Open Electives", href: "/electives", icon: <Library className={iconClass} /> },
      { label: "Timetable", href: "/timetable", icon: <CalendarDays className={iconClass} /> },
      { label: "Attendance", href: "/attendance/report", icon: <ClipboardCheck className={iconClass} /> },
    ],
  },
  {
    label: "Evaluation",
    items: [
      { label: "Overview", href: "/evaluation", icon: <SlidersHorizontal className={iconClass} /> },
      {
        label: "Schemes",
        href: "/evaluation/schemes",
        icon: <SlidersHorizontal className={iconClass} />,
      },
      {
        label: "Registrations",
        href: "/evaluation/course-registrations",
        icon: <ClipboardCheck className={iconClass} />,
      },
      {
        label: "Assessments",
        href: "/evaluation/assessment-events",
        icon: <CalendarDays className={iconClass} />,
      },
      {
        label: "Semester Results",
        href: "/evaluation/results/semester",
        icon: <GraduationCap className={iconClass} />,
      },
      {
        label: "Transcript",
        href: "/evaluation/transcript",
        icon: <ScrollText className={iconClass} />,
      },
    ],
  },
  {
    label: "Administration",
    items: [
      // Restricted to the tenant's own administrators: a head of department
      // manages an academic unit, not the tenant's user directory or its money.
      {
        label: "Users & Roles",
        href: "/users",
        icon: <ShieldCheck className={iconClass} />,
        roles: [ROLES.UNIVERSITY_ADMIN, ROLES.CAMPUS_ADMIN],
      },
      {
        label: "Administrators",
        href: "/users/admins",
        icon: <ShieldCheck className={iconClass} />,
        roles: [ROLES.UNIVERSITY_ADMIN, ROLES.CAMPUS_ADMIN],
      },
      {
        // A head of department reads this about their own department; the
        // report itself is scoped by the API, not by hiding the link.
        label: "Faculty Feedback",
        href: "/feedback",
        icon: <MessageSquare className={iconClass} />,
        roles: [ROLES.UNIVERSITY_ADMIN, ROLES.HOD, ROLES.DEPARTMENT_HOD],
      },
      {
        // PRD §47. Restricted to UNIVERSITY_ADMIN because the trail names who
        // did what to whom — the API enforces the same, so this only hides a
        // link nobody else could follow.
        label: "Audit Trail",
        href: "/governance/audit",
        icon: <ScrollText className={iconClass} />,
        roles: [ROLES.UNIVERSITY_ADMIN],
      },
      {
        label: "Finance",
        href: "/finance/fee-demands",
        icon: <Wallet className={iconClass} />,
        roles: [ROLES.UNIVERSITY_ADMIN],
      },
      {
        label: "Certificates",
        href: "/certificates/templates",
        icon: <Award className={iconClass} />,
        roles: [ROLES.UNIVERSITY_ADMIN],
      },
      { label: "Settings", href: "/settings", icon: <Settings className={iconClass} />, roles: [ROLES.UNIVERSITY_ADMIN] },
    ],
  },
];

// --- Faculty Portal ---------------------------------------------------------

export const FACULTY_NAV: NavGroup[] = [
  {
    items: [
      { label: "Dashboard", href: "/faculty/dashboard", icon: <LayoutDashboard className={iconClass} /> },
      { label: "My Schedule", href: "/faculty/schedule", icon: <CalendarDays className={iconClass} /> },
      { label: "Attendance", href: "/faculty/attendance/mark", icon: <ClipboardCheck className={iconClass} /> },
      { label: "Assignments", href: "/faculty/assignments", icon: <FileText className={iconClass} /> },
      { label: "Exams", href: "/faculty/exams", icon: <BookOpen className={iconClass} /> },
      { label: "My Feedback", href: "/faculty/feedback", icon: <MessageSquare className={iconClass} /> },
    ],
  },
];

// --- Student Portal ---------------------------------------------------------

// --- Parent (W2, PRD §32) ---------------------------------------------------

/**
 * Parent portal navigation.
 *
 * ONLY the §32 items that have a backing API. §32 also names online payments,
 * faculty communication, behavioural reports, leave requests, hostel, transport,
 * events, counsellor appointments and raising concerns — none of which has a
 * model or a defined workflow, so none appears here. A nav entry that leads to
 * a screen the backend cannot fill is a promise the product does not keep.
 *
 * §57 defines no Parent Portal navigation at all, so this list is derived from
 * §32's feature list rather than from a specified menu.
 */
export const PARENT_NAV: NavGroup[] = [
  {
    items: [
      { label: "Dashboard", href: "/parent/dashboard", icon: <LayoutDashboard className={iconClass} /> },
      { label: "Attendance", href: "/parent/attendance", icon: <ClipboardCheck className={iconClass} /> },
      { label: "Timetable", href: "/parent/timetable", icon: <CalendarDays className={iconClass} /> },
      { label: "Results", href: "/parent/results", icon: <GraduationCap className={iconClass} /> },
      { label: "Fees", href: "/parent/fees", icon: <Receipt className={iconClass} /> },
      { label: "Notices", href: "/parent/notices", icon: <Bell className={iconClass} /> },
      { label: "Documents", href: "/parent/documents", icon: <ScrollText className={iconClass} /> },
    ],
  },
];

export const STUDENT_NAV: NavGroup[] = [
  {
    items: [
      { label: "Dashboard", href: "/student/dashboard", icon: <LayoutDashboard className={iconClass} /> },
      { label: "My Profile", href: "/student/profile", icon: <UserRound className={iconClass} /> },
      { label: "My Attendance", href: "/student/attendance", icon: <ClipboardCheck className={iconClass} /> },
      { label: "Timetable", href: "/student/timetable", icon: <CalendarDays className={iconClass} /> },
      { label: "Assignments", href: "/student/assignments", icon: <FileText className={iconClass} /> },
      { label: "Results", href: "/student/results", icon: <GraduationCap className={iconClass} /> },
      { label: "Transcript", href: "/student/transcript", icon: <ScrollText className={iconClass} /> },
      { label: "Open Electives", href: "/student/electives", icon: <Library className={iconClass} /> },
      { label: "Fees", href: "/student/fees", icon: <Receipt className={iconClass} /> },
      { label: "Certificates", href: "/student/certificates", icon: <Award className={iconClass} /> },
      { label: "Notifications", href: "/notifications", icon: <Bell className={iconClass} /> },
    ],
  },
];

// --- Derivations ------------------------------------------------------------

/**
 * Drop entries the user's roles do not permit, then drop any group left empty.
 *
 * The empty-group sweep is what prevents a heading like "Administration"
 * rendering above nothing for a head of department.
 */
export function filterNav(groups: NavGroup[], roles: readonly string[]): SidebarSection[] {
  return groups
    .map((group) => ({
      label: group.label,
      items: group.items
        .filter((item) => !item.roles || item.roles.some((role) => roles.includes(role)))
        .map(({ label, href, icon }) => ({ label, href, icon })),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * URL segment -> display label, for breadcrumbs.
 *
 * Derived from the nav trees above so a renamed link cannot leave a stale
 * breadcrumb behind. The extra entries below cover segments that are real URL
 * levels but never sidebar destinations — "/setup" is a grouping segment, and
 * "[id]" detail routes sit under parents that no nav entry links to directly.
 */
export const NAV_LABELS: Record<string, string> = {
  // Structural segments, absent from the nav because nothing links to them.
  platform: "Platform",
  setup: "Setup",
  calendar: "Calendar",
  curriculum: "Curriculum",
  finance: "Finance",
  certificates: "Certificates",
  attendance: "Attendance",
  users: "Users & Roles",
  roles: "Roles",
  mark: "Mark Attendance",
  report: "Report",
  generate: "Generate",
  issue: "Issue",
  templates: "Templates",
  new: "New",
  edit: "Edit",

  // Leaf segments, mirrored from the trees above.
  dashboard: "Dashboard",
  tenants: "Tenants",
  subscriptions: "Subscriptions",
  campuses: "Campuses",
  schools: "Schools",
  departments: "Departments",
  programmes: "Programmes",
  specialisations: "Specialisations",
  "academic-years": "Academic Years",
  semesters: "Semesters",
  batches: "Batches",
  sections: "Sections",
  students: "Students",
  faculty: "Faculty",
  employees: "Employees",
  courses: "Courses",
  timetable: "Timetable",
  schedule: "Schedule",
  assignments: "Assignments",
  exams: "Exams",
  results: "Results",
  fees: "Fees",
  "fee-structures": "Fee Structures",
  "fee-demands": "Fee Demands",
  student: "Student",
  settings: "Settings",

  // Added alongside the evaluation, elective and feedback screens. Every one is
  // a real URL segment, so an absent entry here leaves a raw slug in the trail.
  evaluation: "Evaluation",
  schemes: "Evaluation Schemes",
  "course-registrations": "Course Registrations",
  "assessment-events": "Assessment Events",
  semester: "Semester Results",
  internal: "Internal Marks",
  external: "External Marks",
  transcript: "Transcript",
  analytics: "Analytics",
  electives: "Open Electives",
  feedback: "Faculty Feedback",
  profile: "Profile",
  notifications: "Notifications",
  admins: "Administrators",
  "feature-flags": "Feature Flags",
};

/** Every role permitted into the university portal, re-exported for layouts. */
export { UNIVERSITY_ROLES };
