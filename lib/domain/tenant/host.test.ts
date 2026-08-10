// ============================================================================
// Host matching decides which institution a request belongs to. A mistake here
// is not a rendering bug — it points one university's hostname at another
// university's data. These assertions are the specification.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isRootHost, normaliseHost, platformSubdomain } from "./host";

describe("normaliseHost", () => {
  it("lower-cases, because DNS is case-insensitive and string compare is not", () => {
    assert.equal(normaliseHost("AKTU.Eduos.COM"), "aktu.eduos.com");
  });

  it("strips the port — transport, not identity", () => {
    assert.equal(normaliseHost("aktu.eduos.com:3000"), "aktu.eduos.com");
    assert.equal(normaliseHost("localhost:3000"), "localhost");
  });

  it("strips one trailing root dot, which browsers do send", () => {
    assert.equal(normaliseHost("aktu.eduos.com."), "aktu.eduos.com");
  });

  it("strips only ONE dot — 'host..' is malformed, not fully qualified", () => {
    assert.equal(normaliseHost("aktu.eduos.com.."), "aktu.eduos.com.");
  });

  it("takes the first entry of a forwarded chain, not the last proxy", () => {
    assert.equal(
      normaliseHost("aktu.eduos.com, proxy1.internal, proxy2.internal"),
      "aktu.eduos.com"
    );
  });

  it("trims surrounding whitespace", () => {
    assert.equal(normaliseHost("  aktu.eduos.com  "), "aktu.eduos.com");
  });

  it("keeps an IPv6 literal intact while removing its port", () => {
    // Colons are the address here, not a separator.
    assert.equal(normaliseHost("[::1]:3000"), "[::1]");
    assert.equal(normaliseHost("[::1]"), "[::1]");
  });

  it("returns null for anything that cannot be a hostname", () => {
    assert.equal(normaliseHost(null), null);
    assert.equal(normaliseHost(undefined), null);
    assert.equal(normaliseHost(""), null);
    assert.equal(normaliseHost("   "), null);
    assert.equal(normaliseHost(":3000"), null);
    assert.equal(normaliseHost("."), null);
  });

  it("does NOT strip www — whether it is the same site is configuration", () => {
    assert.equal(normaliseHost("www.university.edu"), "www.university.edu");
  });

  it("is idempotent, so normalising a stored value changes nothing", () => {
    const once = normaliseHost("AKTU.Eduos.com:443.")!;
    assert.equal(normaliseHost(once), once);
  });
});

describe("platformSubdomain — the security-critical one", () => {
  const ROOT = "eduos.com";

  it("extracts the tenant label", () => {
    assert.equal(platformSubdomain("aktu.eduos.com", ROOT), "aktu");
    assert.equal(platformSubdomain("ipu.eduos.com", ROOT), "ipu");
  });

  it("REFUSES a lookalike domain an attacker could register", () => {
    // The whole reason the leading dot is required. A bare endsWith(root)
    // would return "evil-" here and hand over a tenant lookup.
    assert.equal(platformSubdomain("evil-eduos.com", ROOT), null);
    assert.equal(platformSubdomain("notaeduos.com", ROOT), null);
    assert.equal(platformSubdomain("eduos.com.attacker.net", ROOT), null);
  });

  it("refuses a subdomain of a lookalike", () => {
    assert.equal(platformSubdomain("aktu.evil-eduos.com", ROOT), null);
  });

  it("returns null for the root and its www form — neither names a tenant", () => {
    assert.equal(platformSubdomain("eduos.com", ROOT), null);
    assert.equal(platformSubdomain("www.eduos.com", ROOT), null);
  });

  it("returns the whole multi-label prefix rather than guessing", () => {
    // "a.b" matches no slug, so this resolves to nothing — which is correct.
    // Taking only the first label would make evil.aktu.eduos.com resolve to
    // the "evil" tenant, and taking only the last would resolve it to AKTU.
    assert.equal(platformSubdomain("evil.aktu.eduos.com", ROOT), "evil.aktu");
  });

  it("handles a root domain that itself carries a port, as in development", () => {
    assert.equal(platformSubdomain("demo.localhost", "localhost:3000"), "demo");
  });

  it("returns null for an empty label", () => {
    assert.equal(platformSubdomain(".eduos.com", ROOT), null);
  });
});

describe("isRootHost", () => {
  it("recognises the root and its www form", () => {
    assert.equal(isRootHost("eduos.com", "eduos.com"), true);
    assert.equal(isRootHost("www.eduos.com", "eduos.com"), true);
  });

  it("recognises development localhost once the port is normalised away", () => {
    assert.equal(isRootHost("localhost", "localhost:3000"), true);
  });

  it("does not treat a tenant subdomain as the root", () => {
    assert.equal(isRootHost("aktu.eduos.com", "eduos.com"), false);
  });

  it("does not treat a lookalike as the root", () => {
    assert.equal(isRootHost("evil-eduos.com", "eduos.com"), false);
  });
});
