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
  BookMarked,
  BookOpen,
  Briefcase,
  Building2,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileText,
  Flag,
  Globe,
  GraduationCap,
  Hash,
  LayoutDashboard,
  Library,
  LifeBuoy,
  MessageSquare,
  MessageSquareWarning,
  PlayCircle,
  Receipt,
  School,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  UserCog,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import type { SidebarSection } from "@/components/layout/Sidebar";
import { ROLES, UNIVERSITY_ROLES } from "./roles";
import { MODULE_PAGE_RULES, pathAllowed } from "@/lib/constants/moduleRoutes";

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
      // W4 — PRD §7. The default landing template every new university starts
      // from, and a per-institution page editor behind it.
      { label: "Website CMS", href: "/platform/cms", icon: <Globe className={iconClass} /> },
    ],
  },
];

// --- University Admin -------------------------------------------------------

export const UNIVERSITY_NAV: NavGroup[] = [
  {
    items: [{ label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard className={iconClass} /> }],
  },
  {
    // W4 — PRD §7.3 and §57's "Website CMS" entry. UNIVERSITY_ADMIN only:
    // the API is guarded by requireRole("UNIVERSITY_ADMIN"), and showing the
    // link to a role that would be refused is a menu that lies.
    items: [
      { label: "Website", href: "/website", icon: <Globe className={iconClass} />, roles: [ROLES.UNIVERSITY_ADMIN] },
    ],
  },
  // THE INSTITUTIONAL REGISTRY — UNIVERSITY_ADMIN ONLY.
  //
  // Every API beneath these paths is guarded by requireRole("UNIVERSITY_ADMIN"),
  // so a Controller of Examination or a head of department who followed one of
  // these links reached a page whose every panel answered 403. That is the
  // "menu that lies" this file's own header warns against, and it was the whole
  // of what COE and HOD saw: fifteen links, most of them dead.
  //
  // Restricting them here does not change any authorization — the APIs refused
  // these roles before and refuse them now. It stops the sidebar claiming
  // otherwise.
  {
    label: "Setup",
    items: [
      { label: "Campuses", href: "/setup/campuses", icon: <Building2 className={iconClass} />, roles: [ROLES.UNIVERSITY_ADMIN] },
      { label: "Schools", href: "/setup/schools", icon: <School className={iconClass} />, roles: [ROLES.UNIVERSITY_ADMIN] },
      { label: "Departments", href: "/setup/departments", icon: <Library className={iconClass} />, roles: [ROLES.UNIVERSITY_ADMIN] },
      { label: "Programmes", href: "/setup/programmes", icon: <GraduationCap className={iconClass} />, roles: [ROLES.UNIVERSITY_ADMIN] },
      { label: "Identifiers", href: "/setup/identifiers", icon: <Hash className={iconClass} />, roles: [ROLES.UNIVERSITY_ADMIN] },
    ],
  },
  {
    label: "Academic Calendar",
    items: [
      { label: "Academic Years", href: "/calendar/academic-years", icon: <CalendarRange className={iconClass} />, roles: [ROLES.UNIVERSITY_ADMIN] },
      { label: "Batches", href: "/calendar/batches", icon: <CalendarDays className={iconClass} />, roles: [ROLES.UNIVERSITY_ADMIN] },
    ],
  },
  {
    label: "People",
    items: [
      // TD-W3-6 · PRD §57 lists Admissions under University Administration.
      // Restricted to the tenant's own administrators, matching the API guard —
      // this only hides a link nobody else could follow.
      {
        label: "Admissions",
        href: "/admissions",
        icon: <ClipboardList className={iconClass} />,
        roles: [ROLES.UNIVERSITY_ADMIN],
      },
      // Students and Faculty admit a head of department, whose API narrows the
      // rows to their own department — see lib/auth/departmentScope.ts. The
      // link is honest for both roles: an admin sees the university, a head
      // sees their department. Employees is the university's non-academic
      // registry and stays with the administrator.
      {
        label: "Students",
        href: "/students",
        icon: <Users className={iconClass} />,
        roles: [ROLES.UNIVERSITY_ADMIN, ROLES.DEPARTMENT_HOD, ROLES.HOD],
      },
      {
        label: "Faculty",
        href: "/faculty",
        icon: <UserCog className={iconClass} />,
        roles: [ROLES.UNIVERSITY_ADMIN, ROLES.DEPARTMENT_HOD, ROLES.HOD],
      },
      { label: "Employees", href: "/employees", icon: <Users className={iconClass} />, roles: [ROLES.UNIVERSITY_ADMIN] },
    ],
  },
  {
    label: "Academics",
    items: [
      {
        label: "Courses",
        href: "/curriculum/courses",
        icon: <BookOpen className={iconClass} />,
        roles: [ROLES.UNIVERSITY_ADMIN, ROLES.DEPARTMENT_HOD, ROLES.HOD],
      },
      { label: "Open Electives", href: "/electives", icon: <Library className={iconClass} />, roles: [ROLES.UNIVERSITY_ADMIN] },
      { label: "Timetable", href: "/timetable", icon: <CalendarDays className={iconClass} />, roles: [ROLES.UNIVERSITY_ADMIN] },
      { label: "Attendance", href: "/attendance/report", icon: <ClipboardCheck className={iconClass} />, roles: [ROLES.UNIVERSITY_ADMIN] },
      {
        // PRD 13.2. The REVIEW queue, so it is offered to the unlock tier that
        // decides corrections. A lecturer never reaches this tree at all — the
        // (university) layout redirects FACULTY — and raises corrections from
        // the register instead, watching them at /faculty/attendance/corrections.
        // The API refuses a decision from anyone outside
        // ATTENDANCE_CORRECTION_REVIEW_ROLES regardless of this link.
        label: "Attendance Corrections",
        href: "/attendance/corrections",
        icon: <ClipboardCheck className={iconClass} />,
        roles: [ROLES.UNIVERSITY_ADMIN, ROLES.DEPARTMENT_HOD, ROLES.HOD],
      },
    ],
  },
  {
    // THE EXAMINATION SURFACE — the Controller of Examination's own area.
    //
    // Each entry names exactly the roles its API admits, from the same role
    // arrays under lib/constants that the routes use. The group was ungated, so a
    // CAMPUS_ADMIN and a legacy HOD saw six links that all answered 403, while
    // a COE — whose area this is — saw them alongside a dozen registry links
    // they could not use.
    //
    // Semester Results is narrower than the rest on purpose: its API is
    // SEMESTER_RESULT_READ_ROLES, which is UNIVERSITY_ADMIN and COE only. A
    // head reads their own students' results through Overview and Transcript,
    // not the university-wide semester roll-up.
    label: "Evaluation",
    items: [
      {
        // PRD 57 lists "Examinations" as an area of University Administration
        // and PRD 17.2 puts the examination calendar inside Examination
        // Configuration. The page existed for nobody until now: the API
        // admitted UNIVERSITY_ADMIN, FACULTY and STUDENT, and only the faculty
        // and student portals consumed it, so the university-side area PRD 57
        // names had no screen at all.
        label: "Examinations",
        href: "/examinations",
        icon: <ClipboardList className={iconClass} />,
        roles: [ROLES.UNIVERSITY_ADMIN, ROLES.CONTROLLER_OF_EXAMINATION],
      },
      {
        label: "Overview",
        href: "/evaluation",
        icon: <SlidersHorizontal className={iconClass} />,
        roles: [ROLES.UNIVERSITY_ADMIN, ROLES.CONTROLLER_OF_EXAMINATION, ROLES.DEPARTMENT_HOD, ROLES.HOD],
      },
      {
        label: "Schemes",
        href: "/evaluation/schemes",
        icon: <SlidersHorizontal className={iconClass} />,
        roles: [ROLES.UNIVERSITY_ADMIN, ROLES.CONTROLLER_OF_EXAMINATION, ROLES.DEPARTMENT_HOD, ROLES.HOD],
      },
      {
        label: "Registrations",
        href: "/evaluation/course-registrations",
        icon: <ClipboardCheck className={iconClass} />,
        roles: [ROLES.UNIVERSITY_ADMIN, ROLES.CONTROLLER_OF_EXAMINATION, ROLES.DEPARTMENT_HOD, ROLES.HOD],
      },
      {
        label: "Assessments",
        href: "/evaluation/assessment-events",
        icon: <CalendarDays className={iconClass} />,
        roles: [ROLES.UNIVERSITY_ADMIN, ROLES.CONTROLLER_OF_EXAMINATION, ROLES.DEPARTMENT_HOD, ROLES.HOD],
      },
      {
        label: "Semester Results",
        href: "/evaluation/results/semester",
        icon: <GraduationCap className={iconClass} />,
        roles: [ROLES.UNIVERSITY_ADMIN, ROLES.CONTROLLER_OF_EXAMINATION],
      },
      {
        label: "Transcript",
        href: "/evaluation/transcript",
        icon: <ScrollText className={iconClass} />,
        roles: [ROLES.UNIVERSITY_ADMIN, ROLES.CONTROLLER_OF_EXAMINATION, ROLES.DEPARTMENT_HOD, ROLES.HOD],
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
      // PRD 57 names "My Classes" and "Students" in the Faculty Portal. Both
      // are derived from this lecturer's own timetable and re-authorised
      // server-side; neither is the institutional registry, which stays closed
      // to FACULTY.
      { label: "My Classes", href: "/faculty/classes", icon: <BookOpen className={iconClass} /> },
      { label: "My Schedule", href: "/faculty/schedule", icon: <CalendarDays className={iconClass} /> },
      { label: "Students", href: "/faculty/students", icon: <Users className={iconClass} /> },
      { label: "Attendance", href: "/faculty/attendance/mark", icon: <ClipboardCheck className={iconClass} /> },
      // Where a lecturer learns what became of a correction they raised. The
      // review queue at /attendance/corrections is under the (university)
      // layout, which redirects FACULTY out, so without this entry the approval
      // step is invisible to the person waiting on it.
      { label: "My Corrections", href: "/faculty/attendance/corrections", icon: <MessageSquareWarning className={iconClass} /> },
      { label: "Assignments", href: "/faculty/assignments", icon: <FileText className={iconClass} /> },
      // Marks entry. The endpoint behind it has admitted FACULTY since C6 and
      // confines them to the sittings they conduct; until now nothing could
      // reach it.
      { label: "Evaluation", href: "/faculty/evaluation", icon: <GraduationCap className={iconClass} /> },
      { label: "Exams", href: "/faculty/exams", icon: <BookOpen className={iconClass} /> },
      { label: "My Feedback", href: "/faculty/feedback", icon: <MessageSquare className={iconClass} /> },
      { label: "Profile", href: "/faculty/profile", icon: <UserRound className={iconClass} /> },
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

/**
 * PRD §57 "Recommended Product Navigation → Student Portal", in the doc's own
 * order, followed by the pages this product has that §57 does not name.
 *
 * WHY §57 IS FOLLOWED LITERALLY HERE AND NOT IN PARENT_NAV
 *   §57 specifies a Student Portal menu and specifies no Parent Portal menu at
 *   all. Where the doc names an order, the order is the specification: a
 *   student moving between two institutions on this platform should find the
 *   same menu in the same sequence, and that only holds if the sequence comes
 *   from the document rather than from whichever page was built first.
 *
 * SEVEN OF THESE SIXTEEN LEAD TO A STUB, DELIBERATELY
 *   My Programme, Learning, Examinations, Library, Placements, Events, Support
 *   and AI Assistant have no model and no API — §14, §26, §29, §34, §38 and
 *   §40 are all NOT_STARTED. Their pages render UnavailableState, which says
 *   the capability is not built rather than pretending the data is empty.
 *
 *   This is the one place in this file where a nav entry may lead to a screen
 *   the backend cannot fill, and it is a different decision from PARENT_NAV's
 *   above. The reason is that this menu is a specified shape: an institution
 *   evaluating the product is being shown the portal §57 describes, and the
 *   honest way to show an unbuilt module is to name it as unbuilt — not to
 *   omit it and let the shape look smaller than the roadmap.
 *
 * THE SECOND GROUP IS WHAT §57 OMITS
 *   Transcript, Open Electives and Notifications are working, shipped pages
 *   that §57's list does not contain. Dropping them to match the doc exactly
 *   would hide delivered functionality behind a specification, so they keep
 *   their links under a heading that makes clear they sit outside the §57 set.
 */
export const STUDENT_NAV: NavGroup[] = [
  {
    items: [
      { label: "Home", href: "/student/dashboard", icon: <LayoutDashboard className={iconClass} /> },
      { label: "My Programme", href: "/student/programme", icon: <BookOpen className={iconClass} /> },
      { label: "Learning", href: "/student/learning", icon: <PlayCircle className={iconClass} /> },
      { label: "Timetable", href: "/student/timetable", icon: <CalendarDays className={iconClass} /> },
      { label: "Attendance", href: "/student/attendance", icon: <ClipboardCheck className={iconClass} /> },
      { label: "Assignments", href: "/student/assignments", icon: <FileText className={iconClass} /> },
      { label: "Examinations", href: "/student/examinations", icon: <ClipboardList className={iconClass} /> },
      { label: "Results", href: "/student/results", icon: <GraduationCap className={iconClass} /> },
      { label: "Fees", href: "/student/fees", icon: <Receipt className={iconClass} /> },
      { label: "Certificates", href: "/student/certificates", icon: <Award className={iconClass} /> },
      { label: "Library", href: "/student/library", icon: <Library className={iconClass} /> },
      { label: "Placements", href: "/student/placements", icon: <Briefcase className={iconClass} /> },
      { label: "Events", href: "/student/events", icon: <CalendarRange className={iconClass} /> },
      { label: "Support", href: "/student/support", icon: <LifeBuoy className={iconClass} /> },
      { label: "AI Assistant", href: "/student/ai-assistant", icon: <Sparkles className={iconClass} /> },
      { label: "Profile", href: "/student/profile", icon: <UserRound className={iconClass} /> },
    ],
  },
  {
    label: "More",
    items: [
      { label: "Transcript", href: "/student/transcript", icon: <ScrollText className={iconClass} /> },
      { label: "Open Electives", href: "/student/electives", icon: <BookMarked className={iconClass} /> },
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
export function filterNav(
  groups: NavGroup[],
  roles: readonly string[],
  /**
   * The tenant's enabled modules, for the university console.
   *
   * Omitted by every portal that is not module-governed — the platform console,
   * and the student, faculty and parent portals — and those trees are then
   * filtered by role alone, exactly as before. Passing undefined is therefore
   * "no module gating", not "no modules enabled": the two are different
   * questions and only the university layout can answer the second.
   */
  modules?: ReadonlySet<string>
): SidebarSection[] {
  return groups
    .map((group) => ({
      label: group.label,
      items: group.items
        .filter((item) => !item.roles || item.roles.some((role) => roles.includes(role)))
        // A link the module selection closes is REMOVED, not disabled or
        // hidden with CSS: it is not a destination this university has, and
        // rendering it greyed out would still tell every operator which
        // modules exist and invite a support ticket about each one.
        .filter((item) => modules === undefined || pathAllowed(item.href, modules, MODULE_PAGE_RULES))
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
  cms: "Website CMS",
  website: "Website",

  // The §57 student segments. Present here even for the stubs, because the
  // breadcrumb resolves a URL segment whether or not the page behind it has a
  // backend — an absent entry leaves "ai-assistant" in the trail.
  programme: "My Programme",
  learning: "Learning",
  examinations: "Examinations",
  library: "Library",
  placements: "Placements",
  events: "Events",
  support: "Support",
  "ai-assistant": "AI Assistant",
};

/** Every role permitted into the university portal, re-exported for layouts. */
export { UNIVERSITY_ROLES };
