// ============================================================================
// OWNER  : Gauransh
// MODULE : Seed — Website CMS (W4, PRD §7)
// PURPOSE: The platform's default landing-page template, and one tenant's page
//          seeded from it.
//
// WHY THIS IS ITS OWN FILE
//   prisma/seed.ts seeds identity, academic structure and finance for the demo
//   tenant. The CMS template is not tenant data at all — it belongs to the
//   platform owner and exists before any university does — so mixing it into a
//   function called seedDemoTenant would misplace it.
//
// THE TEMPLATE IS COPIED, NEVER REFERENCED
//   `templateBlocks` below is the platform's starting point. Seeding a tenant
//   COPIES it, with the institution's name substituted, after which the two are
//   unrelated: editing the template later changes nothing that already exists.
//   That is the agreed model — a tenant's published homepage must never change
//   because somebody edited a platform row.
// ============================================================================

import type { PrismaClient } from "../app/generated/prisma/client";
import type { CmsBlocks } from "../lib/domain/cms/blocks";
import { applyInstitutionName } from "../lib/domain/cms/institution";
import { defaultSiteChrome } from "../lib/domain/cms/defaults";

/** The key onboarding looks the default template up by. */
export const DEFAULT_LANDING_KEY = "default-landing";

/**
 * Placeholder imagery, and where it comes from.
 *
 * THESE ARE STAND-INS TO BE REPLACED, NOT ASSETS THIS PRODUCT OWNS
 *   There is no media library yet (§7.3, unbuilt), so a seeded page needs
 *   image URLs from somewhere. Unsplash's CDN is used because it is stable,
 *   free to hotlink and requires no key — but it is an EXTERNAL dependency:
 *   these images will not render offline, and an institution is expected to
 *   replace every one of them with its own photography.
 *
 *   They live in one named object rather than inline in the blocks so that
 *   swapping them is one edit in one place, and so it is obvious at a glance
 *   which parts of the seeded page are placeholder content.
 */
const IMAGES = {
  campus:
    "https://images.unsplash.com/photo-1562774053-701939374585?auto=format&fit=crop&w=1920&q=70",
  undergrad:
    "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=800&q=70",
  postgrad:
    "https://images.unsplash.com/photo-1541339907198-e08756dedf3f?auto=format&fit=crop&w=800&q=70",
  diploma:
    "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=800&q=70",
  research:
    "https://images.unsplash.com/photo-1532094349884-543bc11b234d?auto=format&fit=crop&w=800&q=70",
  event1:
    "https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=800&q=70",
  event2:
    "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=800&q=70",
  event3:
    "https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=800&q=70",
  heroAdmissions:
    "https://images.unsplash.com/photo-1541339907198-e08756dedf3f?auto=format&fit=crop&w=1920&q=70",
  heroResearch:
    "https://images.unsplash.com/photo-1532094349884-543bc11b234d?auto=format&fit=crop&w=1920&q=70",
  student1:
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=70",
  student2:
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=600&q=70",
  student3:
    "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=600&q=70",
  student4:
    "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=600&q=70",
} as const;

/**
 * A placeholder hero video.
 *
 * Google's long-standing public test asset — chosen because it has been
 * reachable for over a decade and needs no account. It is obviously not
 * campus footage: it is here to prove the hero renders video, and an
 * institution replaces it with their own on day one. `IMAGES.campus` is its
 * poster, so the still is what shows until the video buffers, and it is what a
 * visitor keeps if the video never loads.
 */
const SAMPLE_VIDEO =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4";

/**
 * The default landing page, as blocks.
 *
 * `{{institution}}` is substituted at copy time. A token rather than a
 * parameterised builder because the template is DATA — a platform operator
 * edits it through the CMS tab, and whatever they save has to go through the
 * same substitution as this literal does.
 *
 * NO HERO IMAGE, DELIBERATELY
 *   There is no media library yet (§7.3, unbuilt), so an image would have to be
 *   an external URL baked into a seed — a dependency on somebody else's CDN
 *   that breaks the demo the day it moves. The hero renders over the brand
 *   gradient without one, and an editor can paste a URL in the moment they have
 *   one.
 */
export function templateBlocks(): CmsBlocks {
  return [
    {
      id: "hero",
      type: "hero",
      props: {
        // A CAROUSEL BY DEFAULT, because the template's job is to show an
        // operator what the block can do. An institution that wants one panel
        // switches `layout` to "single" and keeps the other two on the shelf —
        // which is exactly why layout is separate from the slide count.
        layout: "carousel",
        autoplaySeconds: 7,
        align: "left",
        height: "standard",

        // Panel one is the block's own props. See the schema note: this is a
        // compatibility decision, not a stylistic one.
        eyebrow: "Admissions open",
        heading: "Build a career worth the effort",
        subheading:
          "{{institution}} combines academic rigour with industry practice — taught by people who have done the work, assessed on what you can actually do.",
        primaryCta: { label: "Apply now", href: "/admissions" },
        secondaryCta: { label: "Explore programmes", href: "#programmes" },
        imageUrl: IMAGES.campus,
        videoUrl: SAMPLE_VIDEO,

        slides: [
          {
            eyebrow: "Intake 2026",
            heading: "Applications close in March",
            subheading:
              "Start an application in a few minutes, save it, and come back when your documents are ready.",
            primaryCta: { label: "Start your application", href: "/admissions" },
            imageUrl: IMAGES.heroAdmissions,
          },
          {
            eyebrow: "Research",
            heading: "Work that leaves the laboratory",
            subheading:
              "Doctoral and masters research supervised by faculty who publish, patent and teach in the same week.",
            primaryCta: { label: "Explore programmes", href: "#programmes" },
            secondaryCta: { label: "Find your school", href: "#schools" },
            imageUrl: IMAGES.heroResearch,
          },
        ],
      },
    },
    {
      id: "band",
      type: "splitBand",
      props: {
        stats: [
          { value: "300+", label: "Teaching faculty" },
          { value: "100+", label: "Courses to choose from" },
        ],
        message:
          "Learn alongside people from across the country, taught by faculty who have built what they teach.",
        cta: { label: "Book a campus visit", href: "/admissions" },
      },
    },
    {
      id: "levels",
      type: "cardGrid",
      props: {
        heading: "Study with us",
        subheading: "Choose the level that fits where you are now.",
        columns: 4,
        items: [
          {
            title: "Under Graduate",
            body: "Four-year degrees with industry projects from the second year.",
            imageUrl: IMAGES.undergrad,
            link: { label: "Explore", href: "/admissions" },
          },
          {
            title: "Post Graduate",
            body: "Two-year masters programmes with a research or industry track.",
            imageUrl: IMAGES.postgrad,
            link: { label: "Explore", href: "/admissions" },
          },
          {
            title: "Diploma",
            body: "Focused, shorter qualifications built around a single skill set.",
            imageUrl: IMAGES.diploma,
            link: { label: "Explore", href: "/admissions" },
          },
          {
            title: "Research",
            body: "Doctoral study supervised by our own research faculty.",
            imageUrl: IMAGES.research,
            link: { label: "Explore", href: "/admissions" },
          },
        ],
      },
    },
    {
      id: "stats",
      type: "stats",
      props: {
        heading: "Where our graduates go",
        items: [
          { label: "Graduates placed", value: "94%" },
          { label: "Recruiting partners", value: "180+" },
          { label: "Median package", value: "₹9.4 LPA" },
          { label: "Years of teaching", value: "25" },
        ],
      },
    },
    {
      id: "schools",
      type: "linkGrid",
      props: {
        heading: "Find your interest",
        subheading:
          "Every discipline here is designed to support your academic advancement and your curiosity.",
        items: [
          { label: "School of Engineering & Technology", icon: "cpu", href: "/admissions" },
          { label: "School of Science", icon: "microscope", href: "/admissions" },
          { label: "School of Design", icon: "palette", href: "/admissions" },
          { label: "School of Commerce & Management", icon: "briefcase", href: "/admissions" },
          { label: "School of Law", icon: "scale", href: "/admissions" },
          { label: "School of Allied Healthcare", icon: "stethoscope", href: "/admissions" },
        ],
      },
    },
    {
      id: "programmes",
      type: "programmes",
      props: {
        heading: "Programmes on offer",
        subheading:
          "Every programme below is live from our academic records — what you see here is what is currently running.",
        limit: 6,
      },
    },
    {
      id: "features",
      type: "features",
      props: {
        heading: "Why students choose us",
        items: [
          {
            title: "Taught by practitioners",
            body: "Faculty who have built the systems they teach, not only read about them.",
            icon: "users",
          },
          {
            title: "Assessed on evidence",
            body: "Continuous internal assessment against published outcomes, not a single final paper.",
            icon: "trophy",
          },
          {
            title: "Verifiable credentials",
            body: "Every certificate we issue carries a QR code any employer can check in seconds.",
            icon: "graduation-cap",
          },
        ],
      },
    },
    {
      id: "events",
      type: "cardGrid",
      props: {
        heading: "Life on campus",
        subheading: "Festivals, technical events and everything between terms.",
        columns: 3,
        items: [
          {
            title: "Annual technical festival",
            body: "Three days of competitions, talks and project showcases run by students.",
            imageUrl: IMAGES.event1,
          },
          {
            title: "Cultural week",
            body: "Music, dance and theatre across every school on campus.",
            imageUrl: IMAGES.event2,
          },
          {
            title: "Convocation",
            body: "Where four years of work becomes a degree — and a verifiable certificate.",
            imageUrl: IMAGES.event3,
          },
        ],
      },
    },
    {
      id: "placements",
      type: "placements",
      props: {
        heading: "Impeccable Placements",
        subheading: "Education that goes where your dreams will take you.",
        stats: [
          {
            value: "94% placed",
            body: "Graduates placed with recruiting partners across the last two cycles.",
            icon: "trophy",
          },
          {
            value: "180+ companies",
            body: "National and global employers who return to campus every year.",
            icon: "briefcase",
          },
        ],
        partners: [
          { name: "TCS" },
          { name: "Amazon" },
          { name: "HSBC" },
          { name: "Adani" },
          { name: "DXC" },
        ],
        students: [
          {
            name: "Aarav Mehta",
            company: "Amazon",
            programme: "B.Tech CSE",
            imageUrl: IMAGES.student1,
          },
          {
            name: "Isha Kapoor",
            company: "TCS",
            programme: "B.Tech IT",
            imageUrl: IMAGES.student2,
          },
          {
            name: "Rohan Desai",
            company: "HSBC",
            programme: "MBA",
            imageUrl: IMAGES.student3,
          },
          {
            name: "Ananya Rao",
            company: "Adani",
            programme: "B.Tech ECE",
            imageUrl: IMAGES.student4,
          },
        ],
        cta: { label: "View more placements", href: "/admissions" },
        autoplaySeconds: 6,
      },
    },
    {
      id: "testimonials",
      type: "testimonials",
      props: {
        heading: "In our students' words",
        items: [
          {
            quote:
              "The internal assessment structure meant I always knew where I stood. No surprises at the end of the semester.",
            name: "A. Sharma",
            role: "B.Tech, Computer Science",
          },
          {
            quote:
              "My employer verified my certificate from the QR code while I was still in the interview.",
            name: "R. Iyer",
            role: "Alumnus, 2025",
          },
        ],
      },
    },
    {
      id: "faq",
      type: "faq",
      props: {
        heading: "Questions applicants ask",
        items: [
          {
            question: "When does admission open?",
            answer:
              "Applications open ahead of each academic session. Start an application any time — you can save and resume it.",
          },
          {
            question: "How do I verify a certificate issued here?",
            answer:
              "Scan the QR code on the certificate, or enter its number on our public verification page. No account is needed.",
          },
          {
            question: "Can I see my attendance and results online?",
            answer:
              "Yes. Every enrolled student gets a portal showing attendance, assignments, results, fees and certificates.",
          },
        ],
      },
    },
    {
      id: "cta",
      type: "cta",
      props: {
        heading: "Applications are open",
        body: "Start your application in a few minutes. You can save it and come back.",
        cta: { label: "Start your application", href: "/admissions" },
      },
    },
  ];
}

// applyInstitutionName and defaultSiteChrome used to live here. They moved to
// lib/domain/cms/{institution,defaults}.ts because the platform's template
// PREVIEW needs both, and a preview that substitutes differently from
// onboarding — or shows a menu onboarding would not produce — is a preview
// nobody can act on. See those files.

/**
 * Give one tenant its header and footer.
 *
 * `update` is empty for the same reason the page's is: re-seeding must not
 * overwrite a menu somebody has since edited.
 */
export async function seedTenantSiteChrome(
  prisma: PrismaClient,
  tenantId: string,
  institution: string
) {
  const chrome = defaultSiteChrome(institution);

  await prisma.cmsSite.upsert({
    where: { tenantId },
    update: {},
    create: { tenantId, ...chrome },
  });

  return {
    navItems: chrome.navItems.length,
    footerColumns: chrome.footerColumns.length,
    socialLinks: chrome.socialLinks.length,
  };
}

/** Upsert the platform-owned default template. */
export async function seedCmsTemplate(prisma: PrismaClient) {
  const blocks = templateBlocks();

  // The chrome the template hands a new university. `{{institution}}` is not
  // used here: the seeded contact line is genuinely institution-specific, so
  // the template deliberately carries no contact details at all — see the
  // TEMPLATE_CHROME_FIELDS note on why publishing a placeholder address is
  // worse than publishing none.
  const { navItems, footerColumns, socialLinks, enquireRail, typography } = defaultSiteChrome("");

  const chrome = { navItems, footerColumns, socialLinks, enquireRail, typography };

  await prisma.cmsTemplate.upsert({
    where: { key: DEFAULT_LANDING_KEY },
    // Overwritten on every seed run so the template tracks this file. Tenant
    // pages and tenant CmsSite rows are NOT touched by that — they are copies.
    update: { blocks, name: "Default landing page", ...chrome },
    create: {
      key: DEFAULT_LANDING_KEY,
      name: "Default landing page",
      description:
        "The starting point copied into a new university's website during onboarding.",
      blocks,
      ...chrome,
    },
  });

  return {
    key: DEFAULT_LANDING_KEY,
    blockCount: blocks.length,
    navItemCount: navItems.length,
  };
}

/**
 * Give one tenant a published landing page, copied from the template.
 *
 * `update` is deliberately EMPTY. Re-running the seed must not overwrite a
 * landing page somebody has since edited — the whole point of a copy is that it
 * belongs to the tenant from the moment it is made.
 */
export async function seedTenantLandingPage(
  prisma: PrismaClient,
  tenantId: string,
  institution: string
) {
  const blocks = applyInstitutionName(templateBlocks(), institution);

  const page = await prisma.cmsPage.upsert({
    where: { tenantId_path: { tenantId, path: "/" } },
    update: {},
    create: {
      tenantId,
      path: "/",
      title: `Home | ${institution}`,
      status: "PUBLISHED",
      draftBlocks: blocks,
      publishedBlocks: blocks,
      publishedAt: new Date(),
      seoTitle: institution,
      seoDescription: `${institution} — programmes, admissions and verified credentials.`,
    },
    select: { id: true, status: true },
  });

  return { pageId: page.id, status: page.status, blockCount: blocks.length };
}
