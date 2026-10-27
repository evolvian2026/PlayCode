"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";

type Result = "selected" | "not_selected" | "awaiting";
interface Experience {
  id: string;
  company: string;
  roleTitle: string;
  driveDate: string;
  result: Result;
  difficulty: number;
  rounds: { name: string; description: string }[];
  tips: string;
  author: string | null;
}
interface Read {
  companies: { company: string; count: number; averageDifficulty: number; selected: number; experiences: Experience[] }[];
}
interface Mine {
  drives: {
    driveId: string;
    company: string;
    roleTitle: string;
    driveDate: string;
    rounds: string[];
    experience: { status: "pending" | "published" | "rejected"; reviewNote: string | null; result: Result; difficulty: number; rounds: { name: string; description: string }[]; tips: string; anonymous: boolean } | null;
  }[];
}

const RESULTS: Record<Result, string> = { selected: "Selected", not_selected: "Not selected", awaiting: "Waiting for the result" };
const DIFFICULTY = ["", "Easy", "Fairly easy", "Moderate", "Hard", "Very hard"];
const STATUS = { pending: ["With the placement cell", "warn"], published: ["Published", "good"], rejected: ["Sent back to you", "bad"] } as const;

function WriteForm({ drive, onSaved }: { drive: Mine["drives"][number]; onSaved: () => void }) {
  const t = useT();
  const e = drive.experience;
  const [result, setResult] = useState<Result>(e?.result ?? "awaiting");
  const [difficulty, setDifficulty] = useState(e?.difficulty ?? 3);
  const [rounds, setRounds] = useState<Record<string, string>>(Object.fromEntries(drive.rounds.map((r) => [r, e?.rounds.find((x) => x.name === r)?.description ?? ""])));
  const [tips, setTips] = useState(e?.tips ?? "");
  const [anonymous, setAnonymous] = useState(e?.anonymous ?? false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api(`/student/placements/${drive.driveId}/experience`, {
        method: "PUT",
        body: { result, difficulty, rounds: drive.rounds.map((name) => ({ name, description: rounds[name] ?? "" })), tips, anonymous },
      });
      onSaved();
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} style={{ gap: 10 }}>
      <label className="stack" style={{ gap: 4 }}>
        <span className="small" style={{ fontWeight: 600 }}>
          {t("Result")}
        </span>
        <select value={result} onChange={(e2) => setResult(e2.target.value as Result)}>
          {Object.entries(RESULTS).map(([k, v]) => (
            <option key={k} value={k}>
              {t(v)}
            </option>
          ))}
        </select>
      </label>
      <div role="group" aria-label={t("How hard was it?")}>
        <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>
          {t("How hard was it?")}
        </div>
        <div className="row wrap">
          {[1, 2, 3, 4, 5].map((d) => (
            <button key={d} type="button" className={`btn small ${difficulty === d ? "primary" : ""}`} aria-pressed={difficulty === d} onClick={() => setDifficulty(d)}>
              {t(DIFFICULTY[d]!)}
            </button>
          ))}
        </div>
      </div>
      {drive.rounds.map((name) => (
        <label key={name} className="stack" style={{ gap: 4 }}>
          <span className="small" style={{ fontWeight: 600 }}>
            {name}
          </span>
          <textarea
            className="prose"
            rows={3}
            value={rounds[name] ?? ""}
            onChange={(e2) => setRounds({ ...rounds, [name]: e2.target.value })}
            maxLength={4000}
            placeholder={t("What happened, what they asked, how long it took. Leave blank if you didn't reach this round.")}
          />
        </label>
      ))}
      <label className="stack" style={{ gap: 4 }}>
        <span className="small" style={{ fontWeight: 600 }}>
          {t("Tips for juniors")}
        </span>
        <textarea className="prose" rows={3} value={tips} onChange={(e2) => setTips(e2.target.value)} maxLength={3000} />
      </label>
      <label className="row small" style={{ gap: 8 }}>
        <input type="checkbox" checked={anonymous} onChange={(e2) => setAnonymous(e2.target.checked)} style={{ width: "auto" }} />
        {t("Post without my name (the placement cell still sees it)")}
      </label>
      <div className="small muted">{t("Don't name interviewers or share anything the company asked you to keep confidential. The placement cell reads every write-up before it's published.")}</div>
      {msg && <ErrorBox message={msg} />}
      <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy}>
        {busy ? t("Sending...") : t(e ? "Send the update" : "Send to the placement cell")}
      </button>
    </form>
  );
}

function WriteView() {
  const t = useT();
  const { data, error, loading, reload } = useApi<Mine>("/student/experiences/mine");
  const [open, setOpen] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  return (
    <div className="stack">
      <div>
        <Link href="/play/experiences" className="small muted">
          ← {t("Interview experiences")}
        </Link>
        <h1 style={{ margin: "6px 0 0" }}>{t("Share your experience")}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {t("Help juniors and batchmates prepare: write about a drive you took part in.")}
        </p>
      </div>
      {data.drives.length === 0 ? (
        <div className="card muted">{t("Once you've taken part in a placement drive, you can write about it here.")}</div>
      ) : (
        data.drives.map((d) => {
          const status = d.experience ? STATUS[d.experience.status] : null;
          return (
            <div key={d.driveId} className="card stack">
              <div className="spread wrap" style={{ gap: 8 }}>
                <div>
                  <b>{d.company}</b>
                  <div className="small muted">
                    {d.roleTitle} · {d.driveDate}
                  </div>
                </div>
                {status ? <span className={`pill ${status[1]}`}>{t(status[0])}</span> : null}
              </div>
              {d.experience?.status === "rejected" && d.experience.reviewNote && (
                <div className="small" style={{ color: "var(--bad-ink)" }}>
                  {t("From the placement cell:")} {d.experience.reviewNote}
                </div>
              )}
              {open === d.driveId ? (
                <WriteForm
                  drive={d}
                  onSaved={() => {
                    setOpen(null);
                    void reload();
                  }}
                />
              ) : (
                <button className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(d.driveId)}>
                  {t(d.experience ? "Edit" : "Write about it")}
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function ReadView({ company }: { company: string | null }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [search, setSearch] = useState(company ?? "");
  const { data, error, loading, reload } = useApi<Read>(`/student/experiences${company ? `?company=${encodeURIComponent(company)}` : ""}`);
  return (
    <div className="stack">
      <div className="spread wrap">
        <h1 style={{ margin: 0 }}>{t("Interview experiences")}</h1>
        <Link href="/play/experiences?write=1" className="btn primary small">
          {t("Share your experience")}
        </Link>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {t("What seniors and batchmates faced in each round of past drives, checked by the placement cell.")}
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(search.trim() ? `/play/experiences?company=${encodeURIComponent(search.trim())}` : "/play/experiences");
        }}
      >
        <input aria-label={t("Company")} placeholder={t("Company, e.g. TCS")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn small">{t("Search")}</button>
      </form>
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.companies.length ? (
        <div className="card muted">{t(company ? "No experiences for this company yet." : "No experiences published yet. Be the first to share one.")}</div>
      ) : (
        data.companies.map((c) => (
          <section key={c.company} className="stack" aria-label={c.company}>
            <h2 style={{ margin: 0 }}>
              {c.company}{" "}
              <span className="small muted" style={{ fontWeight: 400 }}>
                · {t(c.count === 1 ? "1 experience" : "{n} experiences", { n: c.count })} · {t("difficulty {n} of 5", { n: c.averageDifficulty })}
              </span>
            </h2>
            {c.experiences.map((e) => (
              <article key={e.id} className="card stack" style={{ gap: 8 }}>
                <div className="spread wrap" style={{ gap: 8 }}>
                  <div className="small muted">
                    {e.roleTitle} · {new Date(`${e.driveDate}T12:00:00`).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { month: "short", year: "numeric" })} · {e.author ?? t("Anonymous")}
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="pill">{t(DIFFICULTY[e.difficulty]!)}</span>
                    <span className={`pill ${e.result === "selected" ? "good" : e.result === "not_selected" ? "" : "warn"}`}>{t(RESULTS[e.result])}</span>
                  </div>
                </div>
                {e.rounds.map((r) => (
                  <div key={r.name}>
                    <b className="small">{r.name}</b>
                    <div style={{ whiteSpace: "pre-wrap" }}>{r.description}</div>
                  </div>
                ))}
                {e.tips && (
                  <div className="small" style={{ background: "var(--surface-2)", padding: "8px 10px", borderRadius: 8 }}>
                    <b>{t("Tips:")}</b> {e.tips}
                  </div>
                )}
              </article>
            ))}
          </section>
        ))
      )}
    </div>
  );
}

function Experiences() {
  const params = useSearchParams();
  if (params.get("write")) return <WriteView />;
  return <ReadView key={params.get("company") ?? ""} company={params.get("company")} />;
}

export default function ExperiencesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Experiences />
    </Suspense>
  );
}
