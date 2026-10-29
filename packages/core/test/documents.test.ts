import { describe, expect, it } from "vitest";
import { assignSlots, safeFileName, sniffDocumentType } from "../src";

describe("documents", () => {
  it("knows a file by its content, not its name", () => {
    expect(sniffDocumentType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe("application/pdf");
    expect(sniffDocumentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffDocumentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffDocumentType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull(); // an .exe
  });

  it("cleans up file names", () => {
    expect(safeFileName("Sem 1-6 marksheets.PDF", "application/pdf")).toBe("Sem 1-6 marksheets.pdf");
    expect(safeFileName('../../etc/"passwd".pdf', "application/pdf")).toBe("etcpasswd.pdf");
    expect(safeFileName("photo.exe", "image/jpeg")).toBe("photo.jpg");
    expect(safeFileName("<>", "image/png")).toBe("document.png");
  });
});

describe("interview slots", () => {
  it("shares students across panels in turn", () => {
    const start = new Date("2026-11-04T04:30:00Z");
    const slots = assignSlots(["a", "b", "c", "d", "e"], 2, start, 20);
    expect(slots.map((s) => [s.student, s.panel, s.startsAt.toISOString().slice(11, 16)])).toEqual([
      ["a", 0, "04:30"],
      ["b", 1, "04:30"],
      ["c", 0, "04:50"],
      ["d", 1, "04:50"],
      ["e", 0, "05:10"],
    ]);
    expect(assignSlots(["a"], 0, start, 20)).toEqual([]);
  });
});
