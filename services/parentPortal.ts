// ============================================================================
// MODULE : Services — Parent Portal (W2, PRD §32)
// PURPOSE: Every read the parent portal performs.
//
//          Each function names a child by id, and the BACKEND proves that child
//          belongs to the signed-in parent on every request. Nothing here is a
//          permission check — the selected child is a UI convenience, and a
//          tampered id simply answers 404.
// ============================================================================

import type { ApiResponse } from "@/types";
import { apiRequest } from "./client";

export interface ParentChild {
  studentId: string;
  enrollmentNo: string;
  firstName: string;
  lastName: string;
  status: string;
  currentSemester: number;
  programmeName: string | null;
  isPrimary: boolean;
  relation: string;
}

export interface ChildCourseRef {
  id: string;
  code: string;
  name: string;
}

export interface ChildAttendanceRecord {
  id: string;
  date: string;
  status: string;
  sessionType: string;
  remarks: string | null;
  course: ChildCourseRef | null;
}

export interface ChildAttendance {
  records: ChildAttendanceRecord[];
  summary: { returned: number; total: number; presentInReturned: number };
}

export interface ChildTimetableSlot {
  id: string;
  day: string;
  startTime: string;
  endTime: string;
  roomNo: string | null;
  sessionType: string;
  course: { code: string; name: string };
  faculty: { user: { firstName: string; lastName: string } };
}

export interface ChildResult {
  id: string;
  /** Decimal columns arrive as strings — parse at the point of display. */
  marksObtained: string | null;
  grade: string | null;
  gradePoint: string | null;
  isPassed: boolean | null;
  isAbsent: boolean;
  publishedAt: string;
  examination: {
    id: string;
    title: string;
    type: string;
    date: string | null;
    maxMarks: number;
    course: { code: string; name: string } | null;
  };
}

export interface ChildFees {
  demands: {
    id: string;
    dueDate: string;
    totalAmount: string;
    paidAmount: string;
    waivedAmount: string;
    status: string;
    feeStructure: { name: string } | null;
    semester: { name: string } | null;
  }[];
  payments: {
    id: string;
    receiptNo: string;
    amount: string;
    method: string;
    status: string;
    paidAt: string | null;
  }[];
}

export interface ChildNotice {
  id: string;
  title: string;
  body: string;
  category: string;
  audience: string;
  isPinned: boolean;
  publishAt: string | null;
  createdAt: string;
}

export interface ChildDocuments {
  documents: {
    id: string;
    type: string;
    fileName: string;
    fileUrl: string;
    mimeType: string | null;
    isVerified: boolean;
    verifiedAt: string | null;
  }[];
  certificates: {
    id: string;
    certificateNo: string;
    type: string;
    issuedAt: string;
    expiresAt: string | null;
    pdfUrl: string | null;
  }[];
}

/** The signed-in parent's children. Takes no arguments — there is nothing to aim. */
export async function listMyChildren(): Promise<ApiResponse<{ children: ParentChild[] }>> {
  return apiRequest<{ children: ParentChild[] }>("/api/parent/children");
}

const child = (id: string, feature: string) =>
  `/api/parent/children/${encodeURIComponent(id)}/${feature}`;

export async function childAttendance(
  studentId: string,
  limit = 50
): Promise<ApiResponse<ChildAttendance>> {
  return apiRequest<ChildAttendance>(child(studentId, "attendance"), { params: { limit } });
}

export async function childTimetable(
  studentId: string
): Promise<ApiResponse<ChildTimetableSlot[]>> {
  return apiRequest<ChildTimetableSlot[]>(child(studentId, "timetable"));
}

export async function childResults(studentId: string): Promise<ApiResponse<ChildResult[]>> {
  return apiRequest<ChildResult[]>(child(studentId, "results"));
}

export async function childFees(studentId: string): Promise<ApiResponse<ChildFees>> {
  return apiRequest<ChildFees>(child(studentId, "fees"));
}

export async function childNotices(
  studentId: string,
  limit = 50
): Promise<ApiResponse<ChildNotice[]>> {
  return apiRequest<ChildNotice[]>(child(studentId, "notices"), { params: { limit } });
}

export async function childDocuments(
  studentId: string
): Promise<ApiResponse<ChildDocuments>> {
  return apiRequest<ChildDocuments>(child(studentId, "documents"));
}
