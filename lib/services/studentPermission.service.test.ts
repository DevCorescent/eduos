// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Permission System (Phase 21)
// LAYER  : Service — Unit Tests
// PURPOSE: Prove the self-service gate, and prove the matrix reported matches
//          the README's two lists exactly.
//
//          The service depends on one narrow PORT, so all of this runs with no
//          database and no environment. The port records what it was asked,
//          which is how tenant scoping is tested rather than assumed.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AppError } from "@/lib/errors/AppError";
import { StudentStatus } from "@/app/generated/prisma/enums";
import { ROLES } from "@/constants/roles";
import { STUDENT_CAN, STUDENT_CANNOT } from "@/lib/constants/studentPermissions";
import {
  StudentPermissionService,
  type StudentPermissionSubjectPort,
} from "@/lib/services/studentPermission.service";
import type { StudentPermissionSubjectRow } from "@/lib/dto/studentPermission.dto";

const TENANT_ID = "tenant_1";
const USER_ID = "user_1";
const STUDENT_ID = "student_1";

function subjectRow(
  overrides: Partial<StudentPermissionSubjectRow> = {}
): StudentPermissionSubjectRow {
  return {
    id: STUDENT_ID,
    enrollmentNo: "2024CS001",
    status: StudentStatus.ACTIVE,
    ...overrides,
  };
}

/** A port that answers with `row` and records every call it received. */
function portReturning(row: StudentPermissionSubjectRow | null) {
  const calls: Array<{ tenantId: string; userId: string }> = [];

  const port: StudentPermissionSubjectPort = {
    async findSubject(tenantId, userId) {
      calls.push({ tenantId, userId });
      return row;
    },
  };

  return { port, calls };
}

describe("StudentPermissionService.getPermissions", () => {
  it("returns the matrix for a caller who owns a Student row", async () => {
    const { port } = portReturning(subjectRow());
    const service = new StudentPermissionService(port);

    const result = await service.getPermissions(TENANT_ID, USER_ID);

    assert.equal(result.subject.studentId, STUDENT_ID);
    assert.equal(result.subject.enrollmentNo, "2024CS001");
    assert.equal(result.role, ROLES.STUDENT);
  });

  it("resolves the caller by tenant AND user, never by user alone", async () => {
    // A session carried into the wrong tenant must resolve to nothing rather
    // than to a student. That is only possible if the tenant reaches the read.
    const { port, calls } = portReturning(subjectRow());
    const service = new StudentPermissionService(port);

    await service.getPermissions(TENANT_ID, USER_ID);

    assert.deepEqual(calls, [{ tenantId: TENANT_ID, userId: USER_ID }]);
  });

  it("FORBIDS a permitted role that owns no Student row", async () => {
    const { port } = portReturning(null);
    const service = new StudentPermissionService(port);

    await assert.rejects(
      () => service.getPermissions(TENANT_ID, USER_ID),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        // 403 and not 404: distinguishing "you are not a student" from "no such
        // student" would disclose the existence of a record.
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, "FORBIDDEN");
        return true;
      }
    );
  });

  it("serves the SAME matrix to a student who is not ACTIVE", async () => {
    // Nothing in the README reduces a graduated or suspended student's
    // permissions, so inventing that rule would deny access the spec grants.
    const active = new StudentPermissionService(portReturning(subjectRow()).port);
    const graduated = new StudentPermissionService(
      portReturning(subjectRow({ status: StudentStatus.GRADUATED })).port
    );

    const a = await active.getPermissions(TENANT_ID, USER_ID);
    const g = await graduated.getPermissions(TENANT_ID, USER_ID);

    assert.deepEqual(a.can, g.can);
    assert.deepEqual(a.cannot, g.cannot);
    assert.equal(g.subject.status, StudentStatus.GRADUATED);
  });

  it("hands out a COPY of the matrix, so a caller cannot mutate it", async () => {
    // The lists are module-level constants shared by every later request.
    const { port } = portReturning(subjectRow());
    const service = new StudentPermissionService(port);

    const first = await service.getPermissions(TENANT_ID, USER_ID);
    (first.can as unknown[]).length = 0;

    const second = await service.getPermissions(TENANT_ID, USER_ID);
    assert.equal(second.can.length, STUDENT_CAN.length);
  });
});

describe("the matrix itself", () => {
  it("reports every capability the README's Phase 21 CAN list names", () => {
    assert.deepEqual(
      STUDENT_CAN.map((entry) => entry.label),
      [
        "View Dashboard",
        "View Attendance",
        "View Timetable",
        "View Results",
        "View Certificates",
        "View Assignments",
        "Submit Assignments",
        "Download Question Papers",
        "Download Solutions",
        "View Fee Ledger",
        "Download Receipts",
        "Fill Open Electives",
        "Submit Faculty Feedback",
        "View Notifications",
        "Update Profile Photo",
        "Update Contact Details",
      ]
    );
  });

  it("reports every restriction the README's Phase 21 CANNOT list names", () => {
    assert.deepEqual(
      STUDENT_CANNOT.map((entry) => entry.label),
      [
        "Modify Attendance",
        "Modify Marks",
        "Modify Internal Assessment",
        "Modify Timetable",
        "Modify Fees",
        "Modify Curriculum",
        "Modify Faculty Information",
      ]
    );
  });

  it("marks EXACTLY the two 'if permitted' items as conditional", () => {
    // The README qualifies profile-photo and contact-detail editing and nothing
    // else. A third conditional entry appearing here would mean a capability
    // was quietly weakened.
    const conditional = STUDENT_CAN.filter((entry) => "conditional" in entry).map(
      (entry) => entry.key
    );

    assert.deepEqual(conditional, ["UPDATE_PROFILE_PHOTO", "UPDATE_CONTACT_DETAILS"]);
  });

  it("gives every conditional entry a note explaining the qualification", () => {
    for (const entry of STUDENT_CAN) {
      if ("conditional" in entry) {
        assert.ok(entry.note && entry.note.length > 0, `${entry.key} has no note`);
      }
    }
  });

  it("never lists the same key as both permitted and denied", () => {
    const permitted = new Set<string>(STUDENT_CAN.map((entry) => entry.key));

    for (const entry of STUDENT_CANNOT) {
      assert.equal(permitted.has(entry.key), false, `${entry.key} is on both lists`);
    }
  });

  it("uses unique keys throughout, so a client can switch on them", () => {
    const keys = [...STUDENT_CAN, ...STUDENT_CANNOT].map((entry) => entry.key);
    assert.equal(new Set(keys).size, keys.length);
  });
});
