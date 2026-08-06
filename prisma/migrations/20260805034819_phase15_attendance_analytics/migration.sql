-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('MANUAL', 'BIOMETRIC', 'RFID', 'QR', 'FACE', 'IMPORT');

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "source" "AttendanceSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "timetableId" TEXT;

-- CreateIndex
CREATE INDEX "Attendance_courseId_idx" ON "Attendance"("courseId");

-- CreateIndex
CREATE INDEX "Attendance_sectionId_idx" ON "Attendance"("sectionId");

-- CreateIndex
CREATE INDEX "Attendance_facultyId_idx" ON "Attendance"("facultyId");

-- CreateIndex
CREATE INDEX "Attendance_timetableId_idx" ON "Attendance"("timetableId");

-- CreateIndex
CREATE INDEX "Timetable_semesterId_idx" ON "Timetable"("semesterId");

-- CreateIndex
CREATE INDEX "Timetable_courseId_idx" ON "Timetable"("courseId");

-- CreateIndex
CREATE INDEX "Timetable_day_idx" ON "Timetable"("day");

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_timetableId_fkey" FOREIGN KEY ("timetableId") REFERENCES "Timetable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
