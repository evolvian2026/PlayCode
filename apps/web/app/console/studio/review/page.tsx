"use client";

import Link from "next/link";
import { useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface Item {
  id: string;
  stem: string;
  typeLabel: string;
  skillId: string;
  difficulty: 1 | 2 | 3;
  stats: { attempts: number; pValue: number; discrimination: number | null; upperGroupFavourite: string | null };
  flags: { id: string; label: string }[];
  reports: { id: string; reason: string; note: string; staleVersion: boolean; from: string | null; at: string }[];
}

const REASON: Record<string, string> = { wrong_answer: "Answer is wrong", unclear: "Unclear", typo: "Typo", other: "Other" };
const SERIOUS = new Set(["key_suspect", "negative_discrimination"]);

export default function ReviewQueue() {
  const { data, error, loading, reload } = useApi<{ questions: Item[]; analysed: number }>("/console/studio/review");
  const [msg, setMsg] = useState<string | null>(null);

  async function act(path: string, body: unknown, done: string) {
    setMsg(null);
    try {
      await api(path, { body });
      setMsg(done);
      reload();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <Link href="/console/studio" className="small muted">
          Content studio
        </Link>
        <h1 style={{ margin: 0 }}>Review queue</h1>
        <p className="muted" style={{ margin: 0 }}>
          Live questions students reported, or whose numbers suggest a flaw, most serious first. Item analysis uses each student&apos;s first attempt over the last six months
          {data ? ` (${data.analysed} questions with attempts)` : ""}; difficulty and discrimination need at least 30 attempts.
        </p>
      </div>
      {msg && <div className="pill" style={{ alignSelf: "flex-start" }}>{msg}</div>}
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data?.questions.length === 0 ? (
        <div className="card muted">Nothing to review. Reports from students and flagged questions appear here.</div>
      ) : (
        data?.questions.map((q) => (
          <div key={q.id} className="card stack" style={{ gap: 8 }}>
            <div className="spread wrap" style={{ alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <Link href={`/console/studio/edit?id=${encodeURIComponent(q.id)}`}>
                  <b>{q.stem.length > 140 ? `${q.stem.slice(0, 140)}...` : q.stem}</b>
                </Link>
                <div className="small muted">
                  {q.typeLabel} · {q.skillId} · {["", "Easy", "Medium", "Hard"][q.difficulty]} · {q.id}
                </div>
              </div>
              <div className="small" style={{ textAlign: "right" }}>
                {q.stats.attempts} first attempts · {Math.round(q.stats.pValue * 100)}% right
                {q.stats.discrimination !== null && <div className="muted">discrimination {q.stats.discrimination}</div>}
              </div>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {q.flags.map((f) => (
                <span key={f.id} className={`pill ${SERIOUS.has(f.id) ? "bad" : f.id === "reported" ? "warn" : ""}`} title={f.label}>
                  {f.label}
                  {f.id === "key_suspect" && q.stats.upperGroupFavourite ? ` (they pick ${q.stats.upperGroupFavourite})` : ""}
                </span>
              ))}
            </div>
            {q.reports.length > 0 && (
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {q.reports.map((r) => (
                  <li key={r.id}>
                    <b>{REASON[r.reason] ?? r.reason}</b>
                    {r.note && `: "${r.note}"`}
                    <span className="muted">
                      {" "}
                      · {new Date(r.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      {r.from && ` · ${r.from}`}
                      {r.staleVersion && " · about an earlier version"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="row wrap">
              <Link className="btn small" href={`/console/studio/edit?id=${encodeURIComponent(q.id)}`}>
                Edit
              </Link>
              {q.reports.length > 0 && (
                <>
                  <button className="btn small ghost" onClick={() => act(`/console/studio/questions/${encodeURIComponent(q.id)}/reports`, { status: "resolved", resolution: "Fixed" }, "Reports marked fixed")}>
                    Mark reports fixed
                  </button>
                  <button className="btn small ghost" onClick={() => act(`/console/studio/questions/${encodeURIComponent(q.id)}/reports`, { status: "dismissed", resolution: "Checked: no change needed" }, "Reports dismissed")}>
                    Dismiss reports
                  </button>
                </>
              )}
              <button
                className="btn small ghost"
                onClick={() => window.confirm("Retire this question? Students stop getting it; past answers are kept.") && act(`/console/studio/questions/${encodeURIComponent(q.id)}/status`, { status: "retired" }, "Question retired")}
              >
                Retire
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
