// ============================================================================
// OWNER  : Gauransh
// MODULE : Initial University Data Import (W1.6 — PRD §5.1 #14, §54, §55)
// LAYER  : Service — the only module that turns CSV into rows in the database.
// ACCESS : Called only from a route that has already run requirePlatformAdmin().
//
// ONE CODE PATH FOR PREVIEW AND IMPORT
//   §55 Stage 3 asks for "Test imports" and "Final migration" as separate
//   steps. They are the SAME function here, differing only in whether the
//   transaction at the end runs. That is deliberate: a preview computed by
//   different code from the import it precedes is a preview that can lie, and
//   the whole point of previewing is that the operator can trust it.
//
// THE TENANT IS AN ARGUMENT, NEVER A CELL
//   Every lookup and every write below is scoped by the tenantId passed in from
//   the route segment. No CSV column is read as a tenant, and none of the row
//   schemas defines one, so a file cannot reach another university's data even
//   if it tries.
//
// ALL OR NOTHING
//   A commit runs inside one transaction and only after EVERY row has passed
//   validation. A file with one bad row imports nothing — which is what makes a
//   failed import safe to simply retry after fixing the file, rather than
//   leaving the operator to work out which half landed.
//
// RE-IMPORTING IS SAFE
//   A row whose business identifier already exists in this tenant is SKIPPED,
//   not inserted and not treated as an error. Running the same clean file twice
//   therefore imports nothing the second time instead of failing or duplicating.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { parseCsv, toRecord } from "@/lib/utils/csv";
import {
  getImportEntity,
  type ImportEntityDefinition,
} from "@/lib/constants/importEntities";
import { MAX_IMPORT_ROWS, MAX_PERSON_IMPORT_ROWS, ROW_SCHEMAS } from "@/lib/validations/import";
import { hashPassword } from "@/lib/auth/password";
import { generateTemporaryPassword } from "@/lib/services/platformUser.service";
import { generateIdentifier } from "@/lib/services/identifier.service";

/** What went wrong with one row, and where. */
export interface RowError {
  /** 1-based line number in the FILE, so it matches what a spreadsheet shows. */
  line: number;
  /** The column at fault, or null for a whole-row problem. */
  column: string | null;
  message: string;
}

/**
 * A credential issued to one imported person.
 *
 * Present ONLY on a successful commit of an entity that creates users, and only
 * in that one response. The plaintext exists in memory for the length of the
 * request and is never stored, never logged and never re-fetchable — the
 * database holds only its bcrypt hash.
 */
export interface IssuedCredential {
  /** enrollmentNo or employeeId, whichever the entity uses. */
  identifier: string;
  email: string;
  name: string;
  temporaryPassword: string;
}

/** The outcome of a preview or an import. */
export interface ImportReport {
  entity: string;
  mode: "preview" | "commit";
  totalRows: number;
  validRows: number;
  invalidRows: number;
  /** Rows written. Always 0 for a preview. */
  importedRows: number;
  /** Valid rows whose identifier already exists in this university. */
  skippedRows: number;
  errors: RowError[];
  /** True when a commit actually wrote. False for a preview or a refusal. */
  committed: boolean;
  /**
   * One-time credentials for the people just imported.
   *
   * Absent for a preview, for a refusal, and for entities that create no users.
   * The operator downloads these once; nothing can produce them again.
   */
  credentials?: IssuedCredential[];
}

export type ImportResult =
  | { ok: true; report: ImportReport }
  | { ok: false; error: string };

/** Row errors reported back. Bounded so a wholly-wrong file cannot flood a response. */
const MAX_REPORTED_ERRORS = 200;

/**
 * Check the file's columns against the entity's definition.
 *
 * BOTH directions are checked. A missing required column is obvious; an
 * UNKNOWN column is the dangerous one, because it usually means the operator
 * exported the wrong file or renamed a header, and importing the recognised
 * subset would quietly discard data they believe they supplied.
 */
function validateHeaders(
  headers: string[],
  entity: ImportEntityDefinition
): string | null {
  const known = new Set(entity.columns.map((c) => c.name));
  const present = new Set(headers);

  const unknown = headers.filter((h) => !known.has(h));
  if (unknown.length > 0) {
    return `Unrecognised column${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Download the template to see the accepted columns.`;
  }

  const missing = entity.columns
    .filter((c) => c.required && !present.has(c.name))
    .map((c) => c.name);

  if (missing.length > 0) {
    return `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`;
  }

  return null;
}

/** Department codes that exist in this tenant, lower-cased for comparison. */
async function loadDepartments(tenantId: string): Promise<Map<string, string>> {
  const departments = await prisma.department.findMany({
    where: { tenantId },
    select: { id: true, code: true },
  });

  return new Map(departments.map((d) => [d.code.toLowerCase(), d.id]));
}

/** Programme codes that exist in this tenant, for the student lookup. */
async function loadProgrammes(tenantId: string): Promise<Map<string, string>> {
  const programmes = await prisma.programme.findMany({
    where: { tenantId },
    select: { id: true, code: true },
  });
  return new Map(programmes.map((p) => [p.code.toLowerCase(), p.id]));
}

/**
 * What already exists in this tenant, for duplicate detection.
 *
 * `keys` is what a re-import matches on — a code for a course or programme, an
 * EMAIL for a person. Email rather than the identifier, because a migration
 * file may omit enrollmentNo entirely and let the engine issue it; the address
 * is the one thing that is always present and always unique.
 *
 * `identifiers` is separate and is NOT a skip key. An identifier that already
 * belongs to somebody else is a genuine collision and must be reported, not
 * quietly skipped.
 */
async function loadExisting(
  entity: ImportEntityDefinition,
  tenantId: string
): Promise<{ keys: Set<string>; identifiers: Set<string> }> {
  if (entity.key === "course") {
    const rows = await prisma.course.findMany({ where: { tenantId }, select: { code: true } });
    return { keys: new Set(rows.map((r) => r.code.toLowerCase())), identifiers: new Set() };
  }

  if (entity.key === "programme") {
    const rows = await prisma.programme.findMany({ where: { tenantId }, select: { code: true } });
    return { keys: new Set(rows.map((r) => r.code.toLowerCase())), identifiers: new Set() };
  }

  // A person. The address is unique per tenant on User, which is the constraint
  // an insert would hit, so it is the one a re-import must anticipate.
  const users = await prisma.user.findMany({ where: { tenantId }, select: { email: true } });

  const identifierRows =
    entity.key === "student"
      ? (await prisma.student.findMany({ where: { tenantId }, select: { enrollmentNo: true } })).map(
          (r) => r.enrollmentNo
        )
      : entity.key === "faculty"
        ? (
            await prisma.facultyMember.findMany({
              where: { tenantId },
              select: { employeeId: true },
            })
          ).map((r) => r.employeeId)
        : (
            await prisma.employee.findMany({ where: { tenantId }, select: { employeeId: true } })
          ).map((r) => r.employeeId);

  return {
    keys: new Set(users.map((u) => u.email.toLowerCase())),
    identifiers: new Set(identifierRows.map((v) => v.toLowerCase())),
  };
}

/** One validated person row, with its credential already hashed. */
interface PreparedPerson {
  line: number;
  data: Record<string, unknown>;
  temporaryPassword: string;
  passwordHash: string;
}

/**
 * Create the Users and their profiles, inside the caller's transaction.
 *
 * THREE BULK WRITES, NOT THREE PER ROW
 *   Users are inserted with one createMany, read back by address in one query,
 *   and the profiles inserted with one createMany. A per-row loop would be
 *   hundreds of sequential round trips against a database with ~250ms latency.
 *
 *   The one thing that CANNOT be batched is the identifier engine: it issues
 *   from a locked counter and must be called once per row that needs a number.
 *   Rows that carry a legacy identifier — the normal case for a migration —
 *   skip it entirely, which is what keeps a supplied-identifier file fast.
 *
 * ROLES ARE NOT GRANTED HERE
 *   createUserSchema takes no roles and POST /api/users assigns none; roles are
 *   granted separately through POST /api/users/[id]/roles. Import follows the
 *   same shape rather than inventing a role assignment the rest of the product
 *   does not perform. An imported person therefore has an account and a profile
 *   but no role until one is granted — recorded in TECHNICAL_DEBT.md.
 */
async function importPeople(
  tx: Prisma.TransactionClient,
  tenantId: string,
  entity: ImportEntityDefinition,
  prepared: PreparedPerson[],
  credentials: IssuedCredential[],
  roleId: string | null
): Promise<void> {
  await tx.user.createMany({
    data: prepared.map(({ data, passwordHash }) => ({
      tenantId,
      email: data.email as string,
      firstName: data.firstName as string,
      lastName: data.lastName as string,
      phone: (data.phone as string | undefined) ?? null,
      passwordHash,
      // The approved credential policy: the operator has seen this password, so
      // it is a shared secret until its owner replaces it. requireAuth refuses
      // every tenant API until they do (W1.4).
      mustChangePassword: true,
      isActive: true,
    })),
  });

  // Read the ids back by address. createMany returns a count, not rows, and the
  // profile insert needs the userId. Scoped by tenantId, so an address that
  // exists at another university cannot be matched.
  const created = await tx.user.findMany({
    where: { tenantId, email: { in: prepared.map(({ data }) => data.email as string) } },
    select: { id: true, email: true },
  });
  const userIdByEmail = new Map(created.map((u) => [u.email.toLowerCase(), u.id]));

  const identifierColumn = entity.identifierColumn as string;
  const rows: { userId: string; identifier: string; data: Record<string, unknown> }[] = [];

  for (const { data } of prepared) {
    const userId = userIdByEmail.get((data.email as string).toLowerCase());
    // Unreachable: every address was just inserted in this transaction.
    // Narrowed rather than asserted so a future change cannot write undefined.
    if (!userId) throw new Error("Imported user could not be read back.");

    const supplied = data[identifierColumn] as string | undefined;
    const identifier =
      supplied ??
      // PRD §9 — the engine issues when the file omits one, exactly as
      // POST /api/students already does. It throws when no active sequence is
      // configured, which rolls the whole transaction back.
      (await generateIdentifier(
        { tenantId, entityType: entity.identifierEntity as "STUDENT" | "FACULTY" | "EMPLOYEE" },
        tx
      ));

    rows.push({ userId, identifier, data });
  }

  if (entity.key === "student") {
    await tx.student.createMany({
      data: rows.map(({ userId, identifier, data }) => ({
        tenantId,
        userId,
        enrollmentNo: identifier,
        admissionDate: data.admissionDate as Date,
        programmeId: (data.programmeId as string | undefined) ?? null,
        currentSemester: data.currentSemester as number | undefined,
        status: data.status as never,
      })),
    });
  } else if (entity.key === "faculty") {
    await tx.facultyMember.createMany({
      data: rows.map(({ userId, identifier, data }) => ({
        tenantId,
        userId,
        employeeId: identifier,
        joinDate: data.joinDate as Date,
        departmentId: (data.departmentId as string | undefined) ?? null,
        designation: (data.designation as string | undefined) ?? null,
        qualification: (data.qualification as string | undefined) ?? null,
        specialization: (data.specialization as string | undefined) ?? null,
        experience: data.experience as number | undefined,
        status: data.status as never,
      })),
    });
  } else {
    await tx.employee.createMany({
      data: rows.map(({ userId, identifier, data }) => ({
        tenantId,
        userId,
        employeeId: identifier,
        joinDate: data.joinDate as Date,
        departmentId: (data.departmentId as string | undefined) ?? null,
        designation: (data.designation as string | undefined) ?? null,
        type: data.type as never,
        status: data.status as never,
      })),
    });
  }

  // THE ROLE GRANT — inside this same transaction, so a failure here rolls the
  // Users and their profiles back with it. An account that exists but was never
  // authorised is exactly the half-imported state W1.6 refuses to produce.
  //
  // UserRole is @@id([userId, roleId]), so a duplicate grant is impossible by
  // construction rather than by a check. Re-imported rows never reach this
  // function — they were skipped during validation — so a re-run adds nothing.
  //
  // `grantedBy` is left null. The column is a free string with no foreign key
  // and every other writer stores a TENANT user's id there; a platform
  // operator's id would read as a tenant user who does not exist. The actual
  // actor is recorded in the audit entry's `platformActor`, where it is
  // unambiguous.
  if (roleId) {
    await tx.userRole.createMany({
      data: rows.map(({ userId }) => ({ userId, roleId })),
    });
  }

  // Collected only after every write has succeeded, so a rolled-back
  // transaction cannot hand back credentials for accounts that do not exist.
  for (let i = 0; i < rows.length; i += 1) {
    credentials.push({
      identifier: rows[i].identifier,
      email: rows[i].data.email as string,
      name: `${rows[i].data.firstName} ${rows[i].data.lastName}`,
      temporaryPassword: prepared[i].temporaryPassword,
    });
  }
}

/**
 * The id of the tenant role this entity's people receive, or null.
 *
 * Looked up by NAME within the tenant — Role is @@unique([tenantId, name]) and
 * the name is what requireRole compares, so it is the stable identifier across
 * universities. Returns null when the entity grants no role (Employee) or when
 * the role does not exist, and the caller distinguishes the two.
 */
async function loadRoleId(
  entity: ImportEntityDefinition,
  tenantId: string
): Promise<string | null> {
  if (!entity.roleName) return null;

  const role = await prisma.role.findUnique({
    where: { tenantId_name: { tenantId, name: entity.roleName } },
    select: { id: true },
  });

  return role?.id ?? null;
}

/**
 * Validate a CSV, and import it when `mode` is "commit".
 *
 * Returns `ok: false` only for a problem with the FILE as a whole — unparseable
 * text, wrong columns, too many rows. Per-row problems are a successful call
 * with a report describing them, because that is what the operator needs to see.
 */
export async function runImport(
  tenantId: string,
  entityKey: string,
  csvText: string,
  mode: "preview" | "commit",
  actorId: string
): Promise<ImportResult> {
  const entity = getImportEntity(entityKey);
  if (!entity) return { ok: false, error: "Unknown import type." };

  const parsed = parseCsv(csvText);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { headers, rows } = parsed.value;

  const headerError = validateHeaders(headers, entity);
  if (headerError) return { ok: false, error: headerError };

  if (rows.length === 0) {
    return { ok: false, error: "The file has a header row but no data rows." };
  }

  // A person costs a bcrypt hash, so the ceiling is far lower. See
  // MAX_PERSON_IMPORT_ROWS for the measured arithmetic behind the number.
  const rowCap = entity.createsUser ? MAX_PERSON_IMPORT_ROWS : MAX_IMPORT_ROWS;

  if (rows.length > rowCap) {
    return {
      ok: false,
      error: entity.createsUser
        ? `This file has ${rows.length} rows. Each imported person needs an individually hashed password, so import at most ${rowCap} at a time and split larger files.`
        : `This file has ${rows.length} rows. Import at most ${rowCap} at a time.`,
    };
  }

  const schema = ROW_SCHEMAS[entity.key];
  const [departments, programmes, existing, roleId] = await Promise.all([
    loadDepartments(tenantId),
    entity.key === "student" ? loadProgrammes(tenantId) : Promise.resolve(new Map<string, string>()),
    loadExisting(entity, tenantId),
    loadRoleId(entity, tenantId),
  ]);

  // A missing role blocks the whole file equally, so it is a file-level refusal
  // rather than the same error repeated on every row. Import never CREATES a
  // Role: PRD §55 puts "Roles" in Stage 2 Configuration and data import in
  // Stage 3, so the role is expected to exist by the time a file arrives.
  if (entity.roleName && !roleId) {
    return {
      ok: false,
      error: `This university has no ${entity.roleName} role, so imported ${entity.label.toLowerCase()} could not be authorised. Create the ${entity.roleName} role first, then import.`,
    };
  }

  const errors: RowError[] = [];
  const valid: { line: number; data: Record<string, unknown> }[] = [];
  const skipped: number[] = [];
  // Duplicates WITHIN the file. Two rows with the same code would otherwise
  // both pass the against-the-database check and then collide at insert time,
  // failing the whole transaction with a constraint error rather than a
  // readable message naming the second row.
  const seenInFile = new Map<string, number>();
  // Identifiers seen in this file, tracked separately from the skip key: a
  // person is keyed on email, but two rows may still collide on enrollmentNo.
  const seenIdentifiers = new Map<string, number>();

  rows.forEach((row, index) => {
    const line = index + 2; // +1 for the header, +1 because humans count from 1.
    const record = toRecord(headers, row);

    const result = schema.safeParse(record);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({
          line,
          column: issue.path.length > 0 ? String(issue.path[0]) : null,
          message: issue.message,
        });
      }
      return;
    }

    const data = result.data as Record<string, unknown>;
    const code = String(data[entity.duplicateKey] ?? "");
    const codeKey = code.toLowerCase();

    const firstSeenAt = seenInFile.get(codeKey);
    if (firstSeenAt !== undefined) {
      errors.push({
        line,
        column: entity.duplicateKey,
        message: `Duplicate ${entity.duplicateKey} "${code}" — already used on row ${firstSeenAt}.`,
      });
      return;
    }
    seenInFile.set(codeKey, line);

    // Foreign key by CODE, resolved within this tenant only.
    const departmentCode = data.departmentCode as string | undefined;
    let departmentId: string | undefined;

    if (departmentCode) {
      departmentId = departments.get(departmentCode.toLowerCase());
      if (!departmentId) {
        errors.push({
          line,
          column: "departmentCode",
          message: `No department with code "${departmentCode}" exists in this university.`,
        });
        return;
      }
    }

    // Student's optional programme, resolved within this tenant only.
    let programmeId: string | undefined;
    const programmeCode = data.programmeCode as string | undefined;
    if (programmeCode) {
      programmeId = programmes.get(programmeCode.toLowerCase());
      if (!programmeId) {
        errors.push({
          line,
          column: "programmeCode",
          message: `No programme with code "${programmeCode}" exists in this university.`,
        });
        return;
      }
    }

    // ALREADY PRESENT — CHECKED BEFORE THE IDENTIFIER COLLISION, DELIBERATELY.
    //
    // This row describes somebody this university already has, so it is a
    // re-import and is skipped. It must be decided FIRST: an already-imported
    // person carries an identifier that is, of course, already in use, so
    // running the collision check above this line reported every row of a
    // re-run as an error instead of skipping it. Live verification caught
    // exactly that.
    if (existing.keys.has(codeKey)) {
      skipped.push(line);
      return;
    }

    // A supplied identifier that already belongs to somebody else is a genuine
    // collision — a NEW person claiming a number that is taken. Reachable only
    // once the row is known not to be a re-import.
    if (entity.identifierColumn) {
      const supplied = data[entity.identifierColumn] as string | undefined;
      if (supplied) {
        const key = supplied.toLowerCase();
        if (existing.identifiers.has(key)) {
          errors.push({
            line,
            column: entity.identifierColumn,
            message: `${entity.identifierColumn} "${supplied}" is already used in this university.`,
          });
          return;
        }
        const seenAt = seenIdentifiers.get(key);
        if (seenAt !== undefined) {
          errors.push({
            line,
            column: entity.identifierColumn,
            message: `Duplicate ${entity.identifierColumn} "${supplied}" — already used on row ${seenAt}.`,
          });
          return;
        }
        seenIdentifiers.set(key, line);
      }
    }

    valid.push({ line, data: { ...data, departmentId, programmeId } });
  });

  const report: ImportReport = {
    entity: entity.key,
    mode,
    totalRows: rows.length,
    validRows: valid.length,
    invalidRows: errors.length > 0 ? new Set(errors.map((e) => e.line)).size : 0,
    importedRows: 0,
    skippedRows: skipped.length,
    errors: errors.slice(0, MAX_REPORTED_ERRORS),
    committed: false,
  };

  if (mode === "preview") return { ok: true, report };

  // A commit with ANY invalid row writes nothing. Checked before the
  // transaction opens rather than by throwing inside it, so the refusal is a
  // plain report rather than a rolled-back exception.
  if (report.invalidRows > 0) {
    return { ok: true, report };
  }

  if (valid.length === 0) {
    // Everything was already present. A no-op commit is a success — this is
    // exactly what re-running a completed import looks like.
    report.committed = true;
    return { ok: true, report };
  }

  // A person needs a credential, and bcrypt is ~520ms per hash. Generated and
  // hashed BEFORE the transaction opens, so a 200-row import does not hold
  // database locks for the ~105 seconds the hashing takes.
  //
  // The plaintext lives in this array for the length of the request and is
  // returned once. It is never written anywhere: only `passwordHash` reaches
  // Prisma, and the log line at the foot of this function carries counts only.
  const prepared = entity.createsUser
    ? await Promise.all(
        valid.map(async ({ line, data }) => {
          const temporaryPassword = generateTemporaryPassword();
          return { line, data, temporaryPassword, passwordHash: await hashPassword(temporaryPassword) };
        })
      )
    : [];

  const credentials: IssuedCredential[] = [];

  try {
    await prisma.$transaction(
      async (tx) => {
        if (entity.createsUser) {
          await importPeople(tx, tenantId, entity, prepared, credentials, roleId);
          return;
        }

        if (entity.key === "course") {
          await tx.course.createMany({
            data: valid.map(({ data }) => ({
              tenantId,
              code: data.code as string,
              name: data.name as string,
              type: data.type as never,
              credits: data.credits as number | undefined,
              departmentId: (data.departmentId as string | undefined) ?? null,
              description: (data.description as string | undefined) ?? null,
            })),
          });
          return;
        }

        await tx.programme.createMany({
          data: valid.map(({ data }) => ({
            tenantId,
            code: data.code as string,
            name: data.name as string,
            // Non-null by validation: departmentCode is required for a programme
            // and every row reaching here resolved it.
            departmentId: data.departmentId as string,
            type: data.type as never,
            durationValue: data.durationValue as number,
            durationUnit: data.durationUnit as never,
            totalCredits: data.totalCredits as number | undefined,
            eligibility: (data.eligibility as string | undefined) ?? null,
          })),
        });
      },
      {
        // Prisma's default interactive-transaction timeout is 5 seconds. A
        // person import issues identifiers one at a time when the file omits
        // them, and each is a locked round trip — well past 5s for a large
        // file. Raised only for the writes; the slow hashing already happened
        // above, outside this block.
        timeout: 120_000,
        maxWait: 10_000,
      }
    );
  } catch (err) {
    // The unique constraint is the real guarantee; the pre-checks above are the
    // fast path. A concurrent import taking a code between the read and the
    // write lands here, and nothing was written because the transaction rolled
    // back as a whole.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return {
        ok: false,
        error:
          "One or more codes were created by another import while this one was running. Nothing was imported — re-run the preview.",
      };
    }
    throw err;
  }

  report.importedRows = valid.length;
  report.committed = true;

  // Attached ONLY here — after a successful commit of a user-creating entity.
  // A preview returns above without ever reaching this line, so a plaintext
  // password cannot leave the server on a request that wrote nothing.
  if (entity.createsUser) {
    report.credentials = credentials;
  }

  // Ids only, and counts. No row content, so a name or code from a university's
  // data never reaches the platform's server log.
  console.warn(
    `[data-import] ${entity.key} actor=${actorId} tenant=${tenantId} imported=${report.importedRows} skipped=${report.skippedRows}`
  );

  return { ok: true, report };
}
