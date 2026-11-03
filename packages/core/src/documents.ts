// Documents placement cells collect before drives (marksheets, ID proof,
// resumes signed by the HOD), and the interview schedule on a drive day.

/** Uploads accepted for a document request. */
export const DOCUMENT_TYPES = { "application/pdf": "PDF", "image/jpeg": "JPG", "image/png": "PNG" } as const;
export type DocumentType = keyof typeof DOCUMENT_TYPES;
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/** The real type of a file from its first bytes, whatever its name says; null if it isn't one we accept. */
export function sniffDocumentType(bytes: Uint8Array): DocumentType | null {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  return null;
}

/** A file name safe to show and to send back in a download header. */
export function safeFileName(name: string, type: DocumentType): string {
  const ext = type === "application/pdf" ? "pdf" : type === "image/png" ? "png" : "jpg";
  const base = name
    .replace(/\.[^.]*$/, "")
    .replace(/[^\p{L}\p{N} ._-]+/gu, "")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 80);
  return `${base || "document"}.${ext}`;
}

export interface Panel {
  name: string;
  room: string;
  interviewer: string;
}

/**
 * Interview slots for a round: students in order (by roll number) share out
 * across the panels in turn, so every panel starts at the first slot and
 * moves on together. Returns each student's panel and start time.
 */
export function assignSlots<T>(students: T[], panels: number, start: Date, slotMinutes: number): { student: T; panel: number; startsAt: Date }[] {
  if (panels < 1) return [];
  return students.map((student, i) => ({ student, panel: i % panels, startsAt: new Date(start.getTime() + Math.floor(i / panels) * slotMinutes * 60_000) }));
}
