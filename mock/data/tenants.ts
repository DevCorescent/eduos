// ============================================================================
// MODULE : Mock Data — Tenants
// PURPOSE: The institution directory the platform console renders.
//
//          Every field matches the Tenant model's wire shape exactly, including
//          the nullable columns, so a page written against these fixtures needs
//          no change when the live API replaces them. Dates are ISO strings and
//          address is a JSON object, as they arrive over the wire.
//
//          The spread across status and type is deliberate rather than
//          decorative: it is what makes the status filter, the badge colour map
//          and the "trial expiring" surfaces reviewable. A directory of thirty
//          identical ACTIVE universities would leave all three untested.
// ============================================================================

import type { Tenant } from "@/types";
import { daysAgo } from "../utils";

/** Seed rows. Every derived field below is computed from these deterministically. */
interface TenantSeed {
  slug: string;
  name: string;
  type: Tenant["type"];
  status: Tenant["status"];
  city: string;
  state: string;
  established: number;
  ageDays: number;
}

const SEEDS: TenantSeed[] = [
  { slug: "verify", name: "Verify University", type: "UNIVERSITY", status: "ACTIVE", city: "Jaipur", state: "Rajasthan", established: 2004, ageDays: 640 },
  { slug: "amity-global", name: "Amity Global Institute", type: "INSTITUTE", status: "ACTIVE", city: "Noida", state: "Uttar Pradesh", established: 1995, ageDays: 610 },
  { slug: "sunrise-tech", name: "Sunrise Institute of Technology", type: "INSTITUTE", status: "ACTIVE", city: "Pune", state: "Maharashtra", established: 2008, ageDays: 585 },
  { slug: "greenfield", name: "Greenfield College of Arts", type: "COLLEGE", status: "TRIAL", city: "Kochi", state: "Kerala", established: 2014, ageDays: 21 },
  { slug: "narayan-university", name: "Narayan University", type: "UNIVERSITY", status: "ACTIVE", city: "Hyderabad", state: "Telangana", established: 1999, ageDays: 520 },
  { slug: "crescent-medical", name: "Crescent Medical College", type: "COLLEGE", status: "ACTIVE", city: "Chennai", state: "Tamil Nadu", established: 1987, ageDays: 495 },
  { slug: "vidyapeeth", name: "Bharat Vidyapeeth", type: "UNIVERSITY", status: "SUSPENDED", city: "Nagpur", state: "Maharashtra", established: 1978, ageDays: 470 },
  { slug: "horizon-business", name: "Horizon School of Business", type: "SCHOOL", status: "ACTIVE", city: "Gurugram", state: "Haryana", established: 2011, ageDays: 440 },
  { slug: "kaveri-institute", name: "Kaveri Institute of Sciences", type: "INSTITUTE", status: "TRIAL", city: "Bengaluru", state: "Karnataka", established: 2016, ageDays: 12 },
  { slug: "eastern-law", name: "Eastern College of Law", type: "COLLEGE", status: "ACTIVE", city: "Kolkata", state: "West Bengal", established: 1992, ageDays: 415 },
  { slug: "sardar-patel", name: "Sardar Patel Technical University", type: "UNIVERSITY", status: "ACTIVE", city: "Ahmedabad", state: "Gujarat", established: 1983, ageDays: 390 },
  { slug: "himalaya-college", name: "Himalaya College of Education", type: "COLLEGE", status: "CANCELLED", city: "Dehradun", state: "Uttarakhand", established: 2001, ageDays: 365 },
  { slug: "meridian-design", name: "Meridian School of Design", type: "SCHOOL", status: "ACTIVE", city: "Mumbai", state: "Maharashtra", established: 2013, ageDays: 340 },
  { slug: "trinity-college", name: "Trinity College of Commerce", type: "COLLEGE", status: "ACTIVE", city: "Indore", state: "Madhya Pradesh", established: 1996, ageDays: 315 },
  { slug: "aurora-university", name: "Aurora University", type: "UNIVERSITY", status: "TRIAL", city: "Bhubaneswar", state: "Odisha", established: 2019, ageDays: 5 },
  { slug: "ncr-polytechnic", name: "NCR Polytechnic Institute", type: "INSTITUTE", status: "ACTIVE", city: "Faridabad", state: "Haryana", established: 2006, ageDays: 290 },
  { slug: "st-xaviers", name: "St. Xavier's College", type: "COLLEGE", status: "ACTIVE", city: "Panaji", state: "Goa", established: 1963, ageDays: 265 },
  { slug: "deccan-university", name: "Deccan University", type: "UNIVERSITY", status: "ACTIVE", city: "Aurangabad", state: "Maharashtra", established: 1974, ageDays: 240 },
  { slug: "lotus-nursing", name: "Lotus School of Nursing", type: "SCHOOL", status: "SUSPENDED", city: "Lucknow", state: "Uttar Pradesh", established: 2009, ageDays: 215 },
  { slug: "silicon-academy", name: "Silicon Academy of Computing", type: "INSTITUTE", status: "ACTIVE", city: "Bengaluru", state: "Karnataka", established: 2017, ageDays: 190 },
  { slug: "royal-agriculture", name: "Royal College of Agriculture", type: "COLLEGE", status: "ACTIVE", city: "Ludhiana", state: "Punjab", established: 1985, ageDays: 165 },
  { slug: "coastal-university", name: "Coastal University", type: "UNIVERSITY", status: "TRIAL", city: "Visakhapatnam", state: "Andhra Pradesh", established: 2020, ageDays: 30 },
  { slug: "insignia-mgmt", name: "Insignia School of Management", type: "SCHOOL", status: "ACTIVE", city: "Jaipur", state: "Rajasthan", established: 2012, ageDays: 140 },
  { slug: "northeast-tech", name: "North East Technical Institute", type: "INSTITUTE", status: "ACTIVE", city: "Guwahati", state: "Assam", established: 2003, ageDays: 115 },
  { slug: "vivekananda", name: "Vivekananda College", type: "COLLEGE", status: "ACTIVE", city: "Mysuru", state: "Karnataka", established: 1971, ageDays: 90 },
  { slug: "capital-university", name: "Capital University", type: "UNIVERSITY", status: "ACTIVE", city: "New Delhi", state: "Delhi", established: 1990, ageDays: 65 },
  { slug: "pearl-fashion", name: "Pearl School of Fashion", type: "SCHOOL", status: "CANCELLED", city: "Surat", state: "Gujarat", established: 2015, ageDays: 45 },
  { slug: "ganga-institute", name: "Ganga Institute of Pharmacy", type: "INSTITUTE", status: "ACTIVE", city: "Varanasi", state: "Uttar Pradesh", established: 2007, ageDays: 18 },
];

/**
 * Build a full Tenant from a seed row.
 *
 * The nullable columns are populated for some rows and left null for others —
 * driven by the seed's own values rather than at random — so screens that
 * render optional fields are exercised in both states. A fixture where every
 * optional column is filled would hide every missing-value fallback.
 */
function buildTenant(seed: TenantSeed, index: number): Tenant {
  const isEstablished = seed.status === "ACTIVE" || seed.status === "SUSPENDED";
  const createdAt = daysAgo(seed.ageDays);

  return {
    id: `tnt_${String(index + 1).padStart(3, "0")}`,
    slug: seed.slug,
    name: seed.name,
    type: seed.type,
    status: seed.status,
    // Only long-standing tenants have finished branding. A trial that has been
    // open five days genuinely has not uploaded a logo yet.
    logoUrl: isEstablished ? `https://cdn.eduos.dev/logos/${seed.slug}.png` : null,
    faviconUrl: isEstablished ? `https://cdn.eduos.dev/favicons/${seed.slug}.ico` : null,
    primaryColor: isEstablished ? "#4f46e5" : null,
    accentColor: null,
    timezone: "Asia/Kolkata",
    locale: "en",
    country: "IN",
    address: {
      line1: `${seed.name} Campus`,
      city: seed.city,
      state: seed.state,
      country: "India",
    },
    contactEmail: `registrar@${seed.slug}.edu`,
    contactPhone: `+91 ${90000 + index * 137} ${10000 + index * 271}`,
    website: isEstablished ? `https://www.${seed.slug}.edu` : null,
    // Only universities and colleges carry an accreditation number; a private
    // training institute typically does not.
    accreditationNo:
      seed.type === "UNIVERSITY" || seed.type === "COLLEGE"
        ? `NAAC/${seed.established}/${1000 + index}`
        : null,
    establishedYear: seed.established,
    settings: null,
    createdAt,
    updatedAt: createdAt,
  };
}

/**
 * The tenant directory.
 *
 * Sorted newest-first to match the live route, which orders by
 * `createdAt: "desc"`. Getting this wrong would make the mocked first page
 * differ from the real one and hide any ordering bug until integration.
 */
export const MOCK_TENANTS: Tenant[] = SEEDS.map(buildTenant).sort(
  (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
);

export function findMockTenant(id: string): Tenant | undefined {
  return MOCK_TENANTS.find((tenant) => tenant.id === id);
}
