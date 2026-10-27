// A student's dated events in one list, and the iCalendar (RFC 5545) text a
// calendar app subscribes to.

export type CalendarKind = "training" | "test" | "assignment" | "contest" | "drive" | "drive_deadline" | "interview";

export const CALENDAR_KINDS: Record<CalendarKind, string> = {
  training: "Training",
  test: "Test",
  assignment: "Assignment",
  contest: "Contest",
  drive: "Placement drive",
  drive_deadline: "Registration closes",
  interview: "Mock interview",
};

export interface CalendarEvent {
  /** Stable across fetches, so a calendar app updates the event rather than adding a copy. */
  uid: string;
  kind: CalendarKind;
  title: string;
  /** ISO timestamp, or YYYY-MM-DD for an all-day event. */
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
  detail: string | null;
  url: string;
}

const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const day = (ymd: string) => ymd.replace(/-/g, "");
const nextDay = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Bytes a string takes in UTF-8. */
export function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/** Lines longer than 75 octets continue on the next line after a space; a multi-byte character isn't split. */
export function foldIcsLine(line: string): string {
  const bytes = utf8Length;
  if (bytes(line) <= 75) return line;
  const out: string[] = [];
  let current = "";
  for (const ch of line) {
    const limit = out.length ? 74 : 75; // continuation lines start with a space
    if (bytes(current + ch) > limit) {
      out.push(current);
      current = ch;
    } else current += ch;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function toIcs(events: CalendarEvent[], opts: { name: string; now: Date }): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PlayCode//Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${escape(opts.name)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp(opts.now.toISOString())}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${day(e.start)}`, `DTEND;VALUE=DATE:${day(nextDay(e.end ?? e.start))}`);
    } else {
      lines.push(`DTSTART:${stamp(e.start)}`);
      // A deadline is a moment; give it a quarter of an hour so it shows up in day views.
      lines.push(`DTEND:${stamp(e.end ?? new Date(new Date(e.start).getTime() + 15 * 60_000).toISOString())}`);
    }
    lines.push(`SUMMARY:${escape(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escape(e.location)}`);
    lines.push(`DESCRIPTION:${escape([e.detail, e.url].filter(Boolean).join("\n"))}`, `URL:${e.url}`, `CATEGORIES:${escape(CALENDAR_KINDS[e.kind])}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
