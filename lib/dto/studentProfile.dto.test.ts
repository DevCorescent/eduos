// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Profile Portal
// LAYER  : DTO — Unit Tests
// PURPOSE: Prove the boundary conversion is lossless, that the untyped JSON
//          columns are parsed defensively rather than trusted, and that nothing
//          is ever fabricated.
//
//          The JSON tests carry the most weight. permanentAddr, localAddr and
//          emergencyContact are untyped `Json` that nothing has ever validated,
//          so a mapper that cast them to an interface would be making a claim
//          this codebase cannot support — and would throw on the first row
//          written by an older importer.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Prisma } from "@/app/generated/prisma/client";
import {
  AchievementCategory,
  BloodGroup,
  CertificateType,
  DocumentType,
  Gender,
  NotificationType,
} from "@/app/generated/prisma/enums";
import {
  isoDate,
  optionalMoney,
  toAchievementDto,
  toAddressDto,
  toCertificateDto,
  toEmergencyContactDto,
  toNotificationDto,
  toParentDto,
  toProfilePhotoDto,
  toStudentDocumentDto,
  toStudentPersonalDto,
} from "@/lib/dto/studentProfile.dto";

const NOW = new Date("2026-08-07T00:00:00.000Z");
const PAST = new Date("2020-01-01T00:00:00.000Z");
const FUTURE = new Date("2030-01-01T00:00:00.000Z");

describe("optionalMoney", () => {
  it("renders a Decimal at scale", () => {
    assert.equal(optionalMoney(new Prisma.Decimal("450000.5")), "450000.50");
  });

  it("PRESERVES a null rather than reporting zero", () => {
    // An unrecorded income is not an income of zero, and a profile must not
    // print one as the other.
    assert.equal(optionalMoney(null), null);
  });

  it("is a string, never a number", () => {
    assert.equal(typeof optionalMoney(new Prisma.Decimal("1234.55")), "string");
  });
});

describe("isoDate", () => {
  it("renders a Date as ISO-8601", () => {
    assert.equal(isoDate(NOW), "2026-08-07T00:00:00.000Z");
  });

  it("preserves null and undefined alike", () => {
    assert.equal(isoDate(null), null);
    assert.equal(isoDate(undefined), null);
  });
});

describe("toAddressDto — the JSON column is parsed, never trusted", () => {
  it("reads a well-formed address", () => {
    const address = toAddressDto({
      line1: "12 College Road",
      city: "Pune",
      state: "Maharashtra",
      country: "India",
      postalCode: "411001",
    });

    assert.equal(address?.line1, "12 College Road");
    assert.equal(address?.city, "Pune");
    assert.equal(address?.line2, null, "an absent key is null, not undefined");
  });

  it("returns null for a column that was never populated", () => {
    assert.equal(toAddressDto(null), null);
    assert.equal(toAddressDto(undefined), null);
    assert.equal(toAddressDto({}), null);
  });

  it("survives a column holding something that is not an object", () => {
    // An older importer may have written a bare string or a number. The mapper
    // must render an empty address, not throw on a profile request.
    for (const value of ["12 College Road", 42, true, []]) {
      assert.equal(toAddressDto(value), null, JSON.stringify(value));
    }
  });

  it("ignores a field of the wrong type rather than coercing it", () => {
    const address = toAddressDto({ line1: "Valid", city: 12345, state: { nested: true } });

    assert.equal(address?.line1, "Valid");
    assert.equal(address?.city, null);
    assert.equal(address?.state, null);
  });

  it("treats a blank field as absent", () => {
    // A blank line rendered on a profile is worse than an omitted one.
    assert.equal(toAddressDto({ line1: "   ", city: "" }), null);
  });

  it("trims a value", () => {
    assert.equal(toAddressDto({ city: "  Pune  " })?.city, "Pune");
  });

  it("returns an address when even ONE field is usable", () => {
    assert.equal(toAddressDto({ city: "Pune" })?.city, "Pune");
  });
});

describe("toEmergencyContactDto", () => {
  it("reads a well-formed contact", () => {
    const contact = toEmergencyContactDto({
      name: "A. Sharma",
      relation: "Mother",
      phone: "+91 90000 00000",
    });

    assert.equal(contact?.name, "A. Sharma");
    assert.equal(contact?.relation, "Mother");
    assert.equal(contact?.hasContact, true);
  });

  it("reports hasContact when only a phone number exists", () => {
    // A contact you can call is usable even unnamed.
    assert.equal(toEmergencyContactDto({ phone: "+91 90000 00000" })?.hasContact, true);
  });

  it("reports hasContact FALSE when neither a name nor a phone exists", () => {
    // A contact you can neither name nor call is not a contact you can use.
    const contact = toEmergencyContactDto({ relation: "Mother" });

    assert.equal(contact?.relation, "Mother");
    assert.equal(contact?.hasContact, false);
  });

  it("returns null for an empty or malformed column", () => {
    assert.equal(toEmergencyContactDto(null), null);
    assert.equal(toEmergencyContactDto({}), null);
    assert.equal(toEmergencyContactDto("call my mother"), null);
  });
});

describe("toProfilePhotoDto", () => {
  it("prefers the avatar, the primary source", () => {
    const photo = toProfilePhotoDto("https://cdn/avatar.png", "https://cdn/doc.png");

    assert.equal(photo.url, "https://cdn/avatar.png");
    assert.equal(photo.source, "AVATAR");
  });

  it("falls back to an uploaded PHOTO document", () => {
    const photo = toProfilePhotoDto(null, "https://cdn/doc.png");

    assert.equal(photo.url, "https://cdn/doc.png");
    assert.equal(photo.source, "DOCUMENT");
  });

  it("reports NONE rather than an empty string when neither exists", () => {
    const photo = toProfilePhotoDto(null, null);

    assert.equal(photo.url, null);
    assert.equal(photo.source, "NONE");
  });

  it("treats a blank avatar as absent and falls through", () => {
    assert.equal(toProfilePhotoDto("   ", "https://cdn/doc.png").source, "DOCUMENT");
  });

  it("STATES the source rather than leaving it inferred", () => {
    // The two differ in trust: an avatar is self-set, a document may have been
    // verified by the institution.
    assert.equal(toProfilePhotoDto("a", null).source, "AVATAR");
    assert.equal(toProfilePhotoDto(null, "b").source, "DOCUMENT");
  });
});

describe("toParentDto", () => {
  function parentRow(overrides: Record<string, unknown> = {}) {
    return {
      isPrimary: true,
      parent: {
        id: "parent_1",
        firstName: "R",
        lastName: "Sharma",
        email: "r@example.com",
        phone: "+91 90000 00000",
        occupation: "Engineer",
        annualIncome: new Prisma.Decimal("850000"),
        relation: "Father",
        ...overrides,
      },
    };
  }

  it("flattens the parent and carries the relationship flag", () => {
    const dto = toParentDto(parentRow());

    assert.equal(dto.id, "parent_1");
    assert.equal(dto.relation, "Father");
    assert.equal(dto.isPrimary, true, "isPrimary is a property of the RELATIONSHIP");
    assert.equal(dto.annualIncome, "850000.00");
  });

  it("preserves an unrecorded income as null", () => {
    assert.equal(toParentDto(parentRow({ annualIncome: null })).annualIncome, null);
  });

  it("carries no Prisma value across the boundary", () => {
    const dto = toParentDto(parentRow());

    for (const [key, value] of Object.entries(dto)) {
      assert.ok(value === null || typeof value !== "object", `${key} carries an object`);
    }
  });
});

describe("toStudentDocumentDto", () => {
  function documentRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "doc_1",
      type: DocumentType.MARKSHEET,
      fileName: "sem1.pdf",
      fileUrl: "https://cdn/sem1.pdf",
      fileSize: 20480,
      mimeType: "application/pdf",
      isVerified: false,
      verifiedAt: null,
      uploadedAt: PAST,
      ...overrides,
    };
  }

  it("maps an unverified upload", () => {
    const dto = toStudentDocumentDto(documentRow());

    assert.equal(dto.isVerified, false);
    assert.equal(dto.verifiedAt, null);
    assert.equal(dto.uploadedAt, "2020-01-01T00:00:00.000Z");
  });

  it("maps a verified upload with its timestamp", () => {
    const dto = toStudentDocumentDto(documentRow({ isVerified: true, verifiedAt: NOW }));

    assert.equal(dto.isVerified, true);
    assert.equal(dto.verifiedAt, "2026-08-07T00:00:00.000Z");
  });

  it("preserves a null file size rather than reporting zero bytes", () => {
    assert.equal(toStudentDocumentDto(documentRow({ fileSize: null })).fileSize, null);
  });
});

describe("toCertificateDto", () => {
  function certificateRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "cert_1",
      certificateNo: "CERT-001",
      type: CertificateType.BONAFIDE,
      issuedAt: PAST,
      expiresAt: null,
      pdfUrl: "https://cdn/cert.pdf",
      qrCode: "QR",
      isRevoked: false,
      revokedAt: null,
      ...overrides,
    };
  }

  it("treats a certificate with NO expiry as active", () => {
    assert.equal(toCertificateDto(certificateRow(), NOW).isActive, true);
  });

  it("treats a future expiry as active", () => {
    assert.equal(toCertificateDto(certificateRow({ expiresAt: FUTURE }), NOW).isActive, true);
  });

  it("treats a past expiry as INACTIVE", () => {
    assert.equal(toCertificateDto(certificateRow({ expiresAt: PAST }), NOW).isActive, false);
  });

  it("treats an expiry exactly NOW as inactive", () => {
    assert.equal(toCertificateDto(certificateRow({ expiresAt: NOW }), NOW).isActive, false);
  });

  it("treats a REVOKED certificate as inactive however its expiry reads", () => {
    const dto = toCertificateDto(
      certificateRow({ isRevoked: true, revokedAt: PAST, expiresAt: FUTURE }),
      NOW
    );

    assert.equal(dto.isActive, false);
    assert.equal(dto.isRevoked, true, "and the student is TOLD it was revoked");
  });

  it("evaluates every certificate against ONE instant", () => {
    // `now` is a parameter, not a clock read inside the mapper, so two
    // certificates expiring in the same millisecond cannot disagree.
    const rows = [certificateRow({ expiresAt: NOW }), certificateRow({ expiresAt: NOW })];
    const mapped = rows.map((row) => toCertificateDto(row, NOW));

    assert.equal(mapped[0].isActive, mapped[1].isActive);
  });

  it("does not carry the certificate's data blob", () => {
    const dto = toCertificateDto(certificateRow(), NOW);

    assert.equal("data" in dto, false);
  });
});

describe("toAchievementDto", () => {
  const row = {
    id: "ach_1",
    title: "Best Paper Award",
    category: AchievementCategory.RESEARCH,
    description: "IEEE regional conference",
    issuer: "IEEE",
    achievedOn: PAST,
    certificateUrl: null,
    evidenceUrl: "https://doi.org/x",
    createdAt: NOW,
    updatedAt: NOW,
  };

  it("carries every field the model holds", () => {
    const dto = toAchievementDto(row);

    assert.equal(dto.title, "Best Paper Award");
    assert.equal(dto.category, AchievementCategory.RESEARCH);
    assert.equal(dto.issuer, "IEEE");
    assert.equal(dto.evidenceUrl, "https://doi.org/x");
  });

  it("distinguishes when it was ACHIEVED from when it was entered", () => {
    const dto = toAchievementDto(row);

    assert.equal(dto.achievedOn, "2020-01-01T00:00:00.000Z");
    assert.equal(dto.createdAt, "2026-08-07T00:00:00.000Z");
    assert.notEqual(dto.achievedOn, dto.createdAt);
  });

  it("preserves an absent certificate url", () => {
    assert.equal(toAchievementDto(row).certificateUrl, null);
  });

  it("does not echo tenantId or studentId back to the caller", () => {
    const dto = toAchievementDto(row);

    assert.equal("tenantId" in dto, false);
    assert.equal("studentId" in dto, false);
  });

  it("round-trips through JSON unchanged", () => {
    const dto = toAchievementDto(row);

    assert.deepEqual(JSON.parse(JSON.stringify(dto)), dto);
  });
});

describe("toStudentPersonalDto", () => {
  const row = {
    dateOfBirth: PAST,
    gender: Gender.FEMALE,
    bloodGroup: BloodGroup.O_POS,
    nationality: "Indian",
    religion: null,
    category: "GEN",
    motherTongue: "Marathi",
    permanentAddr: { line1: "12 College Road", city: "Pune" },
    localAddr: null,
    emergencyContact: { name: "A. Sharma", phone: "+91 90000 00000" },
    disability: false,
    disabilityDesc: null,
  };

  it("composes the three JSON columns through their own parsers", () => {
    const dto = toStudentPersonalDto(row);

    assert.equal(dto.permanentAddress?.city, "Pune");
    assert.equal(dto.localAddress, null, "an unpopulated column is null, not an empty shell");
    assert.equal(dto.emergencyContact?.hasContact, true);
  });

  it("carries the enums through unchanged", () => {
    const dto = toStudentPersonalDto(row);

    assert.equal(dto.gender, Gender.FEMALE);
    assert.equal(dto.bloodGroup, BloodGroup.O_POS);
  });

  it("survives a personal record where every optional field is absent", () => {
    const dto = toStudentPersonalDto({
      dateOfBirth: null,
      gender: null,
      bloodGroup: null,
      nationality: null,
      religion: null,
      category: null,
      motherTongue: null,
      permanentAddr: null,
      localAddr: null,
      emergencyContact: null,
      disability: false,
      disabilityDesc: null,
    });

    assert.equal(dto.dateOfBirth, null);
    assert.equal(dto.permanentAddress, null);
    assert.equal(dto.emergencyContact, null);
    assert.equal(dto.disability, false);
  });

  it("round-trips through JSON unchanged", () => {
    const dto = toStudentPersonalDto(row);

    assert.deepEqual(JSON.parse(JSON.stringify(dto)), dto);
  });
});

describe("toNotificationDto", () => {
  const row = {
    id: "n1",
    type: NotificationType.EMAIL,
    subject: "Fee reminder",
    body: "Your semester fee is due.",
    sentAt: PAST,
    readAt: null,
  };

  it("derives isRead from readAt rather than exposing the timestamp", () => {
    assert.equal(toNotificationDto(row).isRead, false);
    assert.equal(toNotificationDto({ ...row, readAt: NOW }).isRead, true);
  });

  it("preserves a null subject", () => {
    assert.equal(toNotificationDto({ ...row, subject: null }).subject, null);
  });
});
