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
import { blocksSchema, type CmsBlocks } from "../lib/domain/cms/blocks";

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
        eyebrow: "Admissions open",
        heading: "Build a career worth the effort",
        subheading:
          "{{institution}} combines academic rigour with industry practice — taught by people who have done the work, assessed on what you can actually do.",
        primaryCta: { label: "Apply now", href: "/admissions" },
        secondaryCta: { label: "Explore programmes", href: "#programmes" },
        imageUrl: IMAGES.campus,
        videoUrl: SAMPLE_VIDEO,
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

/**
 * Substitute the institution's name into a copy of the template.
 *
 * Walks the block tree replacing `{{institution}}` in every string. Written
 * over JSON rather than field by field so a template edited in the CMS — with
 * blocks this function has never seen — is substituted just the same.
 */
export function applyInstitutionName(blocks: CmsBlocks, institution: string): CmsBlocks {
  const substituted = JSON.parse(
    JSON.stringify(blocks).replaceAll("{{institution}}", institution)
  );

  // Re-validated after substitution: a long institution name could push a
  // string past its schema bound, and a page that cannot be parsed cannot be
  // rendered. Failing here, in a seed, is far better than failing on a live
  // homepage.
  return blocksSchema.parse(substituted);
}

/**
 * The default navigation, footer and contact block for a new university.
 *
 * EVERY href POINTS AT A ROUTE THAT EXISTS
 *   The reference sites carry a dozen menu items each. Seeding a menu of links
 *   to §7.1 pages nobody has built would make a working product look broken on
 *   the first click, so the menu is short and every entry resolves: "/" is this
 *   page, "/admissions" is the applicant route, "/verify" is public
 *   verification, "/login" is the portal.
 *
 *   An institution adds its own once those pages exist — that is what makes
 *   this navigation data rather than code.
 */
export function defaultSiteChrome(institution: string) {
  return {
    navItems: [
      { label: "Home", href: "/" },
      { label: "Programmes", href: "#programmes" },
      { label: "Admissions", href: "/admissions" },
      { label: "Campus life", href: "#campus" },
      { label: "Verify a certificate", href: "/verify" },
    ],
    footerColumns: [
      {
        heading: "Important links",
        links: [
          { label: "Apply now", href: "/admissions" },
          { label: "Programmes offered", href: "#programmes" },
          { label: "Campus life", href: "#campus" },
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
    ],
    socialLinks: [
      { platform: "facebook" as const, href: "https://facebook.com" },
      { platform: "instagram" as const, href: "https://instagram.com" },
      { platform: "linkedin" as const, href: "https://linkedin.com" },
      { platform: "youtube" as const, href: "https://youtube.com" },
    ],
    contactAddress: `${institution}, Main Campus, Jaipur — 302017`,
    contactPhone: "+91 90000 00000",
    contactEmail: "admissions@example.edu",
  };
}

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

  await prisma.cmsTemplate.upsert({
    where: { key: DEFAULT_LANDING_KEY },
    // Overwritten on every seed run so the template tracks this file. Tenant
    // pages are NOT touched by that — they are copies.
    update: { blocks, name: "Default landing page" },
    create: {
      key: DEFAULT_LANDING_KEY,
      name: "Default landing page",
      description:
        "The starting point copied into a new university's website during onboarding.",
      blocks,
    },
  });

  return { key: DEFAULT_LANDING_KEY, blockCount: blocks.length };
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
