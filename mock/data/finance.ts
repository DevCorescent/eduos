// ============================================================================
// MODULE : Mock Data — Student Finance
// PURPOSE: Fee structures, their components, and one demand per active student
//          for the current semester.
//
//          No backend route serves any of this yet — finance is backend
//          Phase 11. Written against the contract in types/entities.ts.
//
//          Money is carried as a string throughout, matching the Decimal(10,2)
//          columns. It is parsed only at the point of display, in
//          utils/format.ts — nothing here converts to Number, because a running
//          total in floating point is how rounding errors get into a fee ledger.
// ============================================================================

import type { FeeComponent, FeeDemand, FeeStructure } from "@/types";
import { daysAgo, daysAhead, seededInt } from "../utils";
import { MOCK_TENANT_ID, mockId } from "./context";
import { CURRENT_ACADEMIC_YEAR, CURRENT_SEMESTER, MOCK_PROGRAMMES } from "./academics";
import { MOCK_STUDENTS } from "./people";

const CREATED = daysAgo(200);

/** Per-programme-type fee plan, in whole rupees. */
const FEE_PLANS = {
  UNDERGRADUATE: { tuition: 95000, exam: 4500, library: 2000, lab: 6000 },
  POSTGRADUATE: { tuition: 120000, exam: 5000, library: 2500, lab: 7500 },
  DIPLOMA: { tuition: 45000, exam: 3000, library: 1500, lab: 4000 },
  CERTIFICATE: { tuition: 25000, exam: 2000, library: 1000, lab: 0 },
  PHD: { tuition: 60000, exam: 4000, library: 3000, lab: 10000 },
  INTEGRATED: { tuition: 110000, exam: 5000, library: 2500, lab: 8000 },
} as const;

export const MOCK_FEE_STRUCTURES: FeeStructure[] = MOCK_PROGRAMMES.filter(
  (programme) => programme.isActive
).map((programme, i) => ({
  id: mockId("fst", i + 1),
  tenantId: MOCK_TENANT_ID,
  programmeId: programme.id,
  // Scoped to a programme and year, not a specific batch — the same plan
  // applies to every intake of that programme in the year.
  batchId: null,
  academicYearId: CURRENT_ACADEMIC_YEAR.id,
  name: `${programme.code} — ${CURRENT_ACADEMIC_YEAR.name}`,
  description: null,
  isActive: true,
  createdAt: CREATED,
  updatedAt: CREATED,
}));

const STRUCTURE_BY_PROGRAMME = new Map(
  MOCK_FEE_STRUCTURES.map((structure) => [structure.programmeId, structure])
);

/** The line items each structure is made of. */
export const MOCK_FEE_COMPONENTS: FeeComponent[] = MOCK_FEE_STRUCTURES.flatMap(
  (structure, structureIndex) => {
    const programme = MOCK_PROGRAMMES.find((p) => p.id === structure.programmeId)!;
    const plan = FEE_PLANS[programme.type];

    const lines: { type: FeeComponent["type"]; name: string; amount: number }[] = [
      { type: "TUITION", name: "Tuition Fee", amount: plan.tuition },
      { type: "EXAM", name: "Examination Fee", amount: plan.exam },
      { type: "LIBRARY", name: "Library Fee", amount: plan.library },
    ];

    // A certificate programme has no laboratory component; emitting a zero-value
    // line would show "₹0" on the structure rather than omitting the item.
    if (plan.lab > 0) {
      lines.push({ type: "LAB", name: "Laboratory Fee", amount: plan.lab });
    }

    return lines.map(
      (line, lineIndex): FeeComponent => ({
        id: mockId("fcp", structureIndex * 10 + lineIndex + 1, 4),
        feeStructureId: structure.id,
        name: line.name,
        type: line.type,
        amount: `${line.amount}.00`,
        isOptional: false,
        // Academic fees are exempt in India, so nothing here is taxable and
        // taxPercent stays null rather than being set to "0.00".
        isTaxable: false,
        taxPercent: null,
        createdAt: CREATED,
      })
    );
  }
);

/** Total payable under one structure, as a Decimal-safe string. */
function structureTotal(structureId: string): number {
  return MOCK_FEE_COMPONENTS.filter((c) => c.feeStructureId === structureId).reduce(
    (total, component) => total + Number(component.amount),
    0
  );
}

/**
 * One demand per active student for the current semester.
 *
 * Only ACTIVE students are billed. Raising a demand against a withdrawn or
 * graduated student would inflate every outstanding figure on the dashboard
 * with money nobody owes.
 *
 * The paid/partial/overdue mix is seeded per student, so the fee ledger's
 * status filter and the dashboard's "pending" count both have real data.
 */
export const MOCK_FEE_DEMANDS: FeeDemand[] = MOCK_STUDENTS.filter(
  (student) => student.status === "ACTIVE"
).map((student, i): FeeDemand => {
  const seed = `demand-${student.id}`;
  const structure = student.programmeId
    ? STRUCTURE_BY_PROGRAMME.get(student.programmeId)
    : undefined;

  const total = structure ? structureTotal(structure.id) : 100000;
  const roll = seededInt(0, 99, `${seed}-roll`);

  // Roughly: 55% paid, 20% partially paid, 15% pending, 10% overdue.
  let status: FeeDemand["status"];
  let paid: number;

  if (roll < 55) {
    status = "PAID";
    paid = total;
  } else if (roll < 75) {
    status = "PARTIAL";
    // A part payment is a round instalment, not an arbitrary fraction.
    paid = Math.round((total * seededInt(3, 7, `${seed}-part`)) / 10 / 500) * 500;
  } else if (roll < 90) {
    status = "PENDING";
    paid = 0;
  } else {
    status = "OVERDUE";
    paid = 0;
  }

  return {
    id: mockId("fdm", i + 1, 4),
    tenantId: MOCK_TENANT_ID,
    studentId: student.id,
    semesterId: CURRENT_SEMESTER.id,
    feeStructureId: structure?.id ?? null,
    totalAmount: `${total}.00`,
    paidAmount: `${paid}.00`,
    waivedAmount: "0.00",
    status,
    // An overdue demand's due date is in the past — that is what makes it
    // overdue. Anything else would contradict its own status.
    dueDate: status === "OVERDUE" ? daysAgo(seededInt(5, 60, `${seed}-due`)) : daysAhead(30),
    createdAt: CREATED,
    updatedAt: CREATED,
  };
});

/** Demands not yet settled — what the dashboard reports as outstanding. */
export function pendingFeeDemands(): FeeDemand[] {
  return MOCK_FEE_DEMANDS.filter(
    (demand) => demand.status === "PENDING" || demand.status === "PARTIAL" || demand.status === "OVERDUE"
  );
}

/**
 * Total still owed across unsettled demands, as a number for display.
 *
 * Sums (total − paid − waived) rather than the full amount: a partially paid
 * demand only has its remainder outstanding, and counting the whole would
 * overstate what is actually collectable.
 */
export function outstandingAmount(): number {
  return pendingFeeDemands().reduce(
    (sum, demand) =>
      sum + (Number(demand.totalAmount) - Number(demand.paidAmount) - Number(demand.waivedAmount)),
    0
  );
}
