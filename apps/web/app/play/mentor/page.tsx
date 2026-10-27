"use client";

import { MEETING_MODES, type MeetingMode } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";

interface Data {
  mentor: { name: string; email: string } | null;
  meetings: { meetingDate: string; mode: MeetingMode; actionPoints: string; followUpOn: string | null }[];
}

export default function MentorPage() {
  const t = useT();
  const locale = useLocale();
  const { data, error, loading, reload } = useApi<Data>("/student/mentor");
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>{t("My mentor")}</h1>
      {!data.mentor ? (
        <div className="card muted">{t("You don't have a mentor yet. Your college assigns one.")}</div>
      ) : (
        <div className="card">
          <b>{data.mentor.name}</b>
          <div className="small muted">{data.mentor.email}</div>
          <div className="small muted" style={{ marginTop: 6 }}>
            {t("Your mentor follows your preparation through the year. Meet them when you're stuck, or before a big drive.")}
          </div>
        </div>
      )}
      <div className="card stack">
        <h2 style={{ margin: 0 }}>{t("Meetings")}</h2>
        {data.meetings.length === 0 ? (
          <div className="small muted">{t("No meetings recorded yet.")}</div>
        ) : (
          data.meetings.map((m, i) => (
            <div key={`${m.meetingDate}-${i}`} className="stack" style={{ gap: 4 }}>
              <div className="small">
                <b>{fmt(m.meetingDate)}</b> · {t(MEETING_MODES[m.mode])}
                {m.followUpOn ? ` · ${t("next meeting around {date}", { date: fmt(m.followUpOn) })}` : ""}
              </div>
              {m.actionPoints ? (
                <div style={{ background: "var(--surface-2)", padding: "8px 10px", borderRadius: 8 }}>
                  <b className="small">{t("To do:")}</b> {m.actionPoints}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
