// ============================================================================
// TESTS: The public address of a university's website.
//
// This decides where "View site" sends an administrator, and therefore where
// they believe prospective students can reach them. A wrong answer here is a
// dead link on an institution's own marketing.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hostOnly, publicSiteOrigin } from "./publicUrl";

describe("hostOnly", () => {
  it("keeps a bare host with its port", () => {
    assert.equal(hostOnly("localhost:3000"), "localhost:3000");
  });

  it("strips a scheme", () => {
    assert.equal(hostOnly("https://example.edu"), "example.edu");
  });

  it("strips a path, so a link to the site is not a link to one page of it", () => {
    assert.equal(hostOnly("https://example.edu/admissions"), "example.edu");
  });

  it("strips credentials", () => {
    assert.equal(hostOnly("https://user:pw@example.edu"), "example.edu");
  });

  it("lowercases and drops a trailing root dot", () => {
    assert.equal(hostOnly("Example.EDU."), "example.edu");
  });

  it("answers null for nothing usable", () => {
    assert.equal(hostOnly(null), null);
    assert.equal(hostOnly(undefined), null);
    assert.equal(hostOnly("   "), null);
  });
});

describe("publicSiteOrigin", () => {
  it("builds a subdomain of the platform root", () => {
    assert.equal(
      publicSiteOrigin({ slug: "demo", rootDomain: "eduos.com" }),
      "https://demo.eduos.com"
    );
  });

  it("uses http for a local root, where no certificate exists", () => {
    assert.equal(
      publicSiteOrigin({ slug: "demo", rootDomain: "localhost:3000" }),
      "http://demo.localhost:3000"
    );
  });

  it("prefers a verified custom domain over the subdomain", () => {
    // An institution that pointed its own domain at us expects that to be its
    // address; the platform subdomain is then an implementation detail.
    assert.equal(
      publicSiteOrigin({ slug: "demo", customDomain: "www.demo.edu", rootDomain: "eduos.com" }),
      "https://www.demo.edu"
    );
  });

  it("answers null when nothing is configured", () => {
    // A real answer, not a failure: the caller must say "no public address yet"
    // rather than hand the administrator a link that goes nowhere.
    assert.equal(publicSiteOrigin({ slug: "demo", rootDomain: null }), null);
    assert.equal(publicSiteOrigin({ slug: "", rootDomain: "eduos.com" }), null);
  });

  it("refuses a slug that is not a single DNS label", () => {
    // Otherwise the "subdomain" changes which host the link points at.
    assert.equal(publicSiteOrigin({ slug: "a.b", rootDomain: "eduos.com" }), null);
    assert.equal(publicSiteOrigin({ slug: "evil.com/", rootDomain: "eduos.com" }), null);
    assert.equal(publicSiteOrigin({ slug: "-bad", rootDomain: "eduos.com" }), null);
  });

  it("does not depend on the host the administrator happens to be on", () => {
    // The whole point: the address is a property of the institution.
    const a = publicSiteOrigin({ slug: "demo", rootDomain: "eduos.com" });
    const b = publicSiteOrigin({ slug: "demo", rootDomain: "eduos.com" });
    assert.equal(a, b);
  });
});
