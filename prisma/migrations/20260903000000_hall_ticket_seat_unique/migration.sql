-- Seat allocation uniqueness — PRD §17.2 "Seat allocation"
--
-- PURELY ADDITIVE. One unique index on a table introduced in the previous
-- migration. No column is added, altered or dropped and no row is touched.
--
-- WHY THIS IS THE GUARANTEE
--   "Two candidates cannot be given the same seat" is a claim about the data,
--   not about the allocator. Enforced here it holds against every future write
--   path — a re-run of the allocator, a manual correction, a bulk import —
--   rather than only against the one function that exists today.
--
-- WHY NULLS DO NOT COLLIDE
--   PostgreSQL treats NULLs as distinct in a unique index, so any number of
--   hall tickets may remain unallocated (seatNo IS NULL) without conflicting.
--   Only real seat numbers are constrained, which is exactly the rule wanted.

CREATE UNIQUE INDEX "HallTicket_examinationId_seatNo_key"
    ON "HallTicket"("examinationId", "seatNo");
