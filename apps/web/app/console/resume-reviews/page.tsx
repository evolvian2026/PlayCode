"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { RESUME_SECTIONS, type ResumeSection } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface Row {
  id: string;
  student: { id: string; name: string; rollNo: string | null };
  note: string;
  requestedAt: string;
  daysWaiting: number;
  verdict: "ready" | "changes" | null;
  reviewedAt: string | null;
}
interface Review {
  id: string;
  status: "waiting" | "reviewed" | "withdrawn";
  note: string;
  verdictLabel: string | null;
  summary: string;
  reviewer: string | null;
  reviewedAt: string | null;
  comments: { id: string; sectionLabel: string; body: string; resolved: boolean }[];
}
interface Detail {
  review: Review;
  studentId: string;
  resume: {
    name: string;
    rollNo: string | null;
    email: string;
    headline: string;
    about: string;
    links: { github?: string; linkedin?: string; portfolio?: string };
    program: string | null;
    academic: { cgpa: number | null; graduationYear: number | null; tenthPct: number | null; twelfthPct: number | null } | null;
    readiness: { name: string; score: number }[];
    skills: { name: string }[];
    projects: { title: string; organisation: string; period: string; description: string; link: string | null }[];
    internships: { title: string; organisation: string; period: string; description: string; verified: boolean }[];
    certifications: { title: string; organisation: string; period: string; description: string; link: string | null; verified: boolean }[];
  };
  checks: { section: string; sectionLabel: string; level: "fix" | "tip"; message: string }[];
  score: number;
  earlier: Review[];
}

const SECTIONS = Object.keys(RESUME_SECTIONS) as ResumeSection[];
const day = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function Entry({ title, sub, body, extra }: { title: string; sub: string; body: string; extra?: string }) {
  return (
    <div>
      <b>{title}</b>
      {extra && <span className="pill good small"> {extra}</span>}
      <div className="small muted">{sub}</div>
      {body && <div className="small" style={{ whiteSpace: "pre-wrap" }}>{body}</div>}
    </div>
  );
}

function ReviewView({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, loading, reload, setData } = useApi<Detail>(`/console/resume-reviews/${id}`);
  const [comments, setComments] = useState<Partial<Record<ResumeSection, string>>>({});
  const [summary, setSummary] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const r = data.resume;
  async function submit(verdict: "ready" | "changes") {
    setBusy(true);
    setMsg(null);
    try {
      setData(await api<Detail>(`/console/resume-reviews/${id}`, { body: { verdict, summary, comments: SECTIONS.filter((k) => comments[k]?.trim()).map((k) => ({ section: k, body: comments[k] })) } }));
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const box = (k: ResumeSection) =>
    data.review.status === "waiting" ? (
      <div>
        <label htmlFor={`c-${k}`} className="small muted">
          Comment on {RESUME_SECTIONS[k].toLowerCase()}
        </label>
        <textarea className="prose" id={`c-${k}`} rows={2} maxLength={1000} value={comments[k] ?? ""} onChange={(e) => setComments({ ...comments, [k]: e.target.value })} />
      </div>
    ) : null;
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1080 }}>
      <div>
        <button className="btn ghost small" onClick={onBack}>
          ← Resume reviews
        </button>
        <h1 style={{ margin: "6px 0 0" }}>{r.name}</h1>
        <div className="small muted">
          {[r.rollNo, r.program, r.email].filter(Boolean).join(" · ")}
          {data.review.note && <> · asked: &ldquo;{data.review.note}&rdquo;</>}
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 3fr) minmax(260px, 2fr)", gap: 16, alignItems: "start" }}>
        <div className="stack" style={{ gap: 12 }}>
          <section className="card stack" aria-label="Headline and about">
            <div>
              <div className="small muted">Headline</div>
              <b>{r.headline || <span className="muted">none</span>}</b>
            </div>
            {box("headline")}
            <div>
              <div className="small muted">About</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{r.about || <span className="muted">none</span>}</div>
            </div>
            {box("about")}
          </section>
          <section className="card stack" aria-label="Education">
            <div className="small muted">Education</div>
            <div className="small">{r.academic ? `CGPA ${r.academic.cgpa ?? "-"} · class 10 ${r.academic.tenthPct ?? "-"}% · class 12 ${r.academic.twelfthPct ?? "-"}% · graduating ${r.academic.graduationYear ?? "-"}` : "Not on record"}</div>
            {box("education")}
          </section>
          <section className="card stack" aria-label="Projects">
            <div className="small muted">Projects</div>
            {r.projects.length ? r.projects.map((p) => <Entry key={p.title} title={p.title} sub={[p.organisation, p.period, p.link].filter(Boolean).join(" · ")} body={p.description} />) : <div className="small muted">None</div>}
            {box("projects")}
          </section>
          <section className="card stack" aria-label="Internships">
            <div className="small muted">Internships</div>
            {r.internships.length ? r.internships.map((p) => <Entry key={p.title} title={p.title} sub={[p.organisation, p.period].filter(Boolean).join(" · ")} body={p.description} extra={p.verified ? "verified" : undefined} />) : <div className="small muted">None</div>}
            {box("internships")}
          </section>
          <section className="card stack" aria-label="Certifications">
            <div className="small muted">Certifications</div>
            {r.certifications.length ? r.certifications.map((p) => <Entry key={p.title} title={p.title} sub={[p.organisation, p.period, p.link].filter(Boolean).join(" · ")} body={p.description} extra={p.verified ? "verified" : undefined} />) : <div className="small muted">None</div>}
            {box("certifications")}
          </section>
          <section className="card stack" aria-label="Skills and links">
            <div className="small muted">Skills and practice</div>
            <div className="small">
              {r.readiness.map((x) => `${x.name} readiness ${x.score}`).join(" · ")}
              {r.skills.length ? ` · mastered: ${r.skills.map((s) => s.name).join(", ")}` : " · no skills mastered yet"}
            </div>
            {box("skills")}
            <div className="small muted">Links</div>
            <div className="small">{Object.values(r.links).filter(Boolean).join(" · ") || "None"}</div>
            {box("links")}
          </section>
        </div>
        <div className="stack" style={{ gap: 12, position: "sticky", top: 16 }}>
          <section className="card stack" aria-labelledby="h-checks">
            <div className="spread">
              <h2 id="h-checks" style={{ margin: 0 }}>
                Automatic checks
              </h2>
              <span className={`pill ${data.score >= 85 ? "good" : data.score >= 60 ? "warn" : "bad"}`}>{data.score} / 100</span>
            </div>
            {data.checks.length ? (
              data.checks.map((c) => (
                <div key={c.message} className="small">
                  <b>{c.sectionLabel}:</b> {c.message}
                </div>
              ))
            ) : (
              <div className="small muted">Nothing flagged.</div>
            )}
          </section>
          {data.review.status === "waiting" ? (
            <section className="card stack" aria-labelledby="h-verdict">
              <h2 id="h-verdict" style={{ margin: 0 }}>
                Your review
              </h2>
              <div>
                <label htmlFor="c-summary">Overall</label>
                <textarea className="prose" id="c-summary" rows={3} maxLength={2000} value={summary} onChange={(e) => setSummary(e.target.value)} />
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                <button className="btn primary small" disabled={busy} onClick={() => submit("ready")}>
                  Ready to send
                </button>
                <button className="btn small" disabled={busy} onClick={() => submit("changes")}>
                  Needs changes
                </button>
              </div>
              {msg && <ErrorBox message={msg} />}
            </section>
          ) : (
            <section className="card stack" aria-labelledby="h-done">
              <h2 id="h-done" style={{ margin: 0 }}>
                {data.review.verdictLabel}
              </h2>
              <div className="small muted">
                {data.review.reviewer} · {data.review.reviewedAt && day(data.review.reviewedAt)}
              </div>
              {data.review.summary && <div>{data.review.summary}</div>}
              {data.review.comments.map((c) => (
                <div key={c.id} className="small">
                  {c.resolved ? "✓ " : ""}
                  <b>{c.sectionLabel}:</b> {c.body}
                </div>
              ))}
            </section>
          )}
          {data.earlier.length > 0 && (
            <section className="card stack" aria-labelledby="h-earlier">
              <h2 id="h-earlier" style={{ margin: 0, fontSize: "1rem" }}>
                Earlier reviews
              </h2>
              {data.earlier.map((e) => (
                <div key={e.id} className="small">
                  <b>{e.verdictLabel}</b> · {e.reviewer} · {e.reviewedAt && day(e.reviewedAt)} · {e.comments.filter((c) => c.resolved).length} of {e.comments.length} comments done
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Reviews() {
  const router = useRouter();
  const id = useSearchParams().get("id");
  const [tab, setTab] = useState<"waiting" | "reviewed">("waiting");
  const { data, error, loading, reload } = useApi<{ waiting: number; reviews: Row[] }>(id ? null : `/console/resume-reviews?status=${tab}`);
  if (id) return <ReviewView key={id} id={id} onBack={() => router.push("/console/resume-reviews")} />;
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1000 }}>
      <div>
        <h1 style={{ margin: 0 }}>Resume reviews</h1>
        <p className="muted" style={{ margin: 0 }}>
          Students who asked for their resume to be reviewed, oldest first. Comment by section and say whether it&apos;s ready to send.
        </p>
      </div>
      <div className="row" role="group" aria-label="Show">
        {(["waiting", "reviewed"] as const).map((k) => (
          <button key={k} className={`btn small ${tab === k ? "primary" : ""}`} aria-pressed={tab === k} onClick={() => setTab(k)}>
            {k === "waiting" ? `Waiting${data?.waiting ? ` (${data.waiting})` : ""}` : "Reviewed"}
          </button>
        ))}
      </div>
      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.reviews.length ? (
        <div className="card muted">{tab === "waiting" ? "Nobody is waiting." : "None yet."}</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Their note</th>
                  <th>{tab === "waiting" ? "Waiting" : "Verdict"}</th>
                </tr>
              </thead>
              <tbody>
                {data.reviews.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a
                        href={`/console/resume-reviews?id=${r.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          router.push(`/console/resume-reviews?id=${r.id}`);
                        }}
                      >
                        {r.student.name}
                      </a>
                      <div className="small muted">{r.student.rollNo}</div>
                    </td>
                    <td className="small">{r.note || <span className="muted">-</span>}</td>
                    <td className="small">
                      {tab === "waiting" ? (
                        <span className={r.daysWaiting >= 3 ? "pill bad" : ""}>{r.daysWaiting === 0 ? "today" : `${r.daysWaiting} day${r.daysWaiting === 1 ? "" : "s"}`}</span>
                      ) : (
                        <>
                          <span className={`pill ${r.verdict === "ready" ? "good" : "warn"}`}>{r.verdict === "ready" ? "Ready" : "Changes"}</span> {r.reviewedAt && day(r.reviewedAt)}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ResumeReviewsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Reviews />
    </Suspense>
  );
}
