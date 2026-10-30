"use client";

import Link from "next/link";
import { RECRUITER_DIMENSIONS, RETURN_INTENTIONS, type RecruiterDimension, type ReturnIntention } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";

interface Summary {
  responses: number;
  waiting: number;
  companies: Record<RecruiterDimension, number | null>;
  panel: { interviews: number; communication: number | null; technical: number | null; problemSolving: number | null };
  priorities: { dimension: RecruiterDimension; label: string; average: number; priority: boolean; trainingLabel: string }[];
  returning: Record<ReturnIntention, number>;
  plannedHires: number;
  comments: { company: string; roleTitle: string; driveDate: string; wentWell: string; gaps: string; returnLabel: string | null; respondent: string }[];
}

function Rating({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="spread small">
        <span>{label}</span>
        <b>{value === null ? "-" : `${value} / 5`}</b>
      </div>
      <div className={`bar ${value === null ? "" : value < 3 ? "bad" : value < 3.5 ? "warn" : "good"}`} aria-hidden>
        <span style={{ width: `${((value ?? 0) / 5) * 100}%` }} />
      </div>
    </div>
  );
}

export default function RecruiterFeedbackPage() {
  const { data, error, loading, reload } = useApi<Summary>("/console/recruiter-feedback");
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const top = data.priorities.filter((p) => p.priority);
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1080 }}>
      <div>
        <h1 style={{ margin: 0 }}>Recruiter feedback</h1>
        <p className="muted" style={{ margin: 0 }}>
          What companies said about the students over the last year: {data.responses} answer{data.responses === 1 ? "" : "s"}
          {data.waiting ? `, ${data.waiting} link${data.waiting === 1 ? "" : "s"} waiting for an answer` : ""}. Ask for feedback from a drive&apos;s page.
        </p>
      </div>
      {top.length > 0 && (
        <section className="card stack" aria-labelledby="h-priorities" style={{ borderColor: "var(--warn)" }}>
          <h2 id="h-priorities" style={{ margin: 0 }}>
            Where training should focus
          </h2>
          {top.map((p) => (
            <div key={p.dimension} className="spread wrap" style={{ gap: 8 }}>
              <div>
                <b>{p.label}</b> <span className="small muted">rated {p.average} / 5</span>
              </div>
              <Link className="btn small" href="/console/training?view=new">
                Plan {p.trainingLabel.toLowerCase()} sessions
              </Link>
            </div>
          ))}
        </section>
      )}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <section className="card stack" aria-labelledby="h-companies">
          <h2 id="h-companies" style={{ margin: 0 }}>
            Companies&apos; ratings
          </h2>
          {(Object.keys(RECRUITER_DIMENSIONS) as RecruiterDimension[]).map((d) => (
            <Rating key={d} label={RECRUITER_DIMENSIONS[d].label} value={data.companies[d]} />
          ))}
          <div className="small muted">
            {(Object.keys(RETURN_INTENTIONS) as ReturnIntention[])
              .filter((k) => data.returning[k])
              .map((k) => `${RETURN_INTENTIONS[k]}: ${data.returning[k]}`)
              .join(" · ")}
            {data.plannedHires ? ` · about ${data.plannedHires} hires planned` : ""}
          </div>
        </section>
        <section className="card stack" aria-labelledby="h-panel">
          <h2 id="h-panel" style={{ margin: 0 }}>
            Interview panels&apos; ratings
          </h2>
          {data.panel.interviews ? (
            <>
              <Rating label="Communication" value={data.panel.communication} />
              <Rating label="Technical knowledge" value={data.panel.technical} />
              <Rating label="Problem solving" value={data.panel.problemSolving} />
              <div className="small muted">From {data.panel.interviews} interviews with feedback recorded.</div>
            </>
          ) : (
            <div className="small muted">No interview feedback recorded this year. Panels can rate students on a drive&apos;s interview schedule.</div>
          )}
        </section>
      </div>
      <section className="stack" aria-labelledby="h-comments">
        <h2 id="h-comments" style={{ margin: 0 }}>
          What they said
        </h2>
        {data.comments.length === 0 && <div className="card muted">No answers yet.</div>}
        {data.comments.map((c) => (
          <div key={c.company + c.driveDate} className="card stack" style={{ gap: 6 }}>
            <div className="spread wrap" style={{ gap: 8 }}>
              <b>
                {c.company} <span className="small muted">· {c.roleTitle}</span>
              </b>
              {c.returnLabel && <span className="pill">{c.returnLabel}</span>}
            </div>
            {c.wentWell && (
              <div>
                <span className="small muted">Went well: </span>
                {c.wentWell}
              </div>
            )}
            {c.gaps && (
              <div>
                <span className="small muted">Fell short: </span>
                {c.gaps}
              </div>
            )}
            {c.respondent && <div className="small muted">{c.respondent}</div>}
          </div>
        ))}
      </section>
    </div>
  );
}
