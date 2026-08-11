// ============================================================================
// OWNER  : Gauransh
// MODULE : Website CMS — Default Site Chrome (W4c, PRD §7.1)
// LAYER  : Domain (pure)
// PURPOSE: The navigation bar, footer and social accounts a university starts
//          with, and what the template preview falls back to.
//
// MOVED OUT OF THE SEED SO THREE CALLERS CAN SHARE ONE ANSWER
//   The seed writes it into the template row; onboarding copies it into a new
//   university; the platform's template preview renders it when the template
//   row predates the columns that hold it. Three copies of "what does a new
//   site's menu look like" would drift, and the drift would only be visible as
//   a preview that does not match what onboarding actually produces.
//
// EVERY href POINTS AT A ROUTE OR AN ANCHOR THAT EXISTS
//   The reference university sites carry a dozen menu items each. Seeding links
//   to §7.1 pages nobody has built would make a working product look broken on
//   the first click. So: "/" is the landing page, "/admissions" is the
//   applicant route, "/verify" is public verification, "/login" is the portal,
//   and "#programmes" and "#schools" are ids the programmes and link-tile
//   blocks actually render.
//
//   An institution adds its own the moment it has more pages — which is what
//   makes this navigation DATA rather than code.
// ============================================================================

import type { EnquireRail, FooterColumn, NavItem, SocialLink } from "./site";
import type { Typography } from "./typography";

/**
 * The menu, with dropdowns.
 *
 * TWO OF FIVE ITEMS HAVE CHILDREN, DELIBERATELY. A menu where every item opens
 * something is a menu a visitor cannot move across without a panel appearing
 * under the pointer; the reference sites mix flat entries with grouped ones for
 * exactly that reason.
 */
export function defaultNavItems(): NavItem[] {
  return [
    { label: "Home", href: "/" },
    {
      label: "About",
      href: "/",
      children: [
        { label: "Overview", href: "/", description: "Who we are and how we teach." },
        { label: "Vision & mission", href: "/", description: "What we work toward." },
        { label: "Leadership", href: "/", description: "The people who set the direction." },
        { label: "Approvals & accreditation", href: "/" },
      ],
    },
    {
      label: "Academics",
      href: "#programmes",
      children: [
        {
          label: "Programmes on offer",
          href: "#programmes",
          description: "Every course currently running, live from our records.",
        },
        {
          label: "Schools & departments",
          href: "#schools",
          description: "Browse by discipline.",
        },
      ],
    },
    {
      label: "Admissions",
      href: "/admissions",
      children: [
        { label: "Apply now", href: "/admissions", description: "Start an application in minutes." },
        { label: "Entry requirements", href: "/admissions" },
        { label: "Fees & scholarships", href: "/admissions" },
      ],
    },
    {
      label: "Career & placements",
      href: "#placements",
      children: [
        { label: "Placement record", href: "#placements", description: "Outcomes and recruiting partners." },
        { label: "Student success", href: "#placements" },
      ],
    },
    { label: "Verify a certificate", href: "/verify" },
    {
      label: "Portals",
      href: "/login",
      children: [
        { label: "Student portal", href: "/login" },
        { label: "Faculty portal", href: "/login" },
        { label: "Parent portal", href: "/login" },
      ],
    },
  ];
}

export function defaultFooterColumns(): FooterColumn[] {
  return [
    {
      heading: "Important links",
      links: [
        { label: "Apply now", href: "/admissions" },
        { label: "Programmes offered", href: "#programmes" },
        { label: "Schools & departments", href: "#schools" },
      ],
    },
    {
      heading: "Portals",
      links: [
        { label: "Student portal", href: "/login" },
        { label: "Faculty portal", href: "/login" },
        { label: "Parent portal", href: "/login" },
      ],
    },
  ];
}

export function defaultSocialLinks(): SocialLink[] {
  return [
    { platform: "facebook", href: "https://facebook.com" },
    { platform: "instagram", href: "https://instagram.com" },
    { platform: "linkedin", href: "https://linkedin.com" },
    { platform: "youtube", href: "https://youtube.com" },
  ];
}

/**
 * The enquire dock starts ON in the template so an operator sees it in preview,
 * with a short set of actions they will replace. A university that does not want
 * it turns `enabled` off in the chrome editor — the dock then renders nothing.
 */
export function defaultEnquireRail(): EnquireRail {
  return {
    enabled: true,
    label: "Enquire Now",
    items: [
      { label: "WhatsApp chat", href: "https://wa.me/", icon: "whatsapp" },
      { label: "Apply now", href: "/admissions", icon: "apply" },
      { label: "Call admissions", href: "mailto:admissions@example.edu", icon: "phone" },
      { label: "Ask a question", href: "/admissions", icon: "message" },
    ],
  };
}

/**
 * No overrides.
 *
 * EMPTY IS THE RIGHT DEFAULT and not an oversight: the design system's own type
 * is legible on every screen, and shipping a template that pins a colour and a
 * weight would mean every university starts by undoing a decision nobody made
 * for them. The controls are there the moment an institution wants them.
 */
export function defaultTypography(): Typography {
  return {};
}

/** Everything a new university's CmsSite row starts with. */
export function defaultSiteChrome(institution: string) {
  return {
    navItems: defaultNavItems(),
    footerColumns: defaultFooterColumns(),
    socialLinks: defaultSocialLinks(),
    enquireRail: defaultEnquireRail(),
    typography: defaultTypography(),
    contactAddress: `${institution}, Main Campus, Jaipur — 302017`,
    contactPhone: "+91 90000 00000",
    contactEmail: "admissions@example.edu",
  };
}
