"use client";

import { useEffect, useState } from "react";
import { Bar, ErrorBox, Loading, Stat } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

type PaperSet = "A" | "B";
interface KeyItem {
  kind: "option" | "mark";
  options: number;
  expect: string;
}

interface Sheet {
  paper: { id: string; title: string; sets: number; questions: number; marks: number; marksPerQuestion: number };
  format: Partial<Record<PaperSet, KeyItem[]>>;
  students: { id: string; name: string; rollNo: string | null; result: { set: PaperSet; answers: string; score: number } | null }[];
}

interface Report {
  paper: { title: string; questions: number; marks: number };
  students: number;
  entered: number;
  average: number | null;
  highest: number | null;
  lowest: number | null;
  distribution: number[];
  questions: { n: number; id: string; stem: string; skill: string; rightPct: number; blankPct: number }[];
  skills: { id: string; name: string; questions: number; rightPct: number }[];
  results: { userId: string; name: string; rollNo: string | null; set: PaperSet; score: number; pct: number }[];
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** The same check the server makes, so a row shows its problem or score as it's typed. */
function check(key: KeyItem[] | undefined, typed: string, marksPerQuestion: number): { score: number } | { error: string } | null {
  if (!key) return { error: "This paper has one set" };
  const answers = typed.toLowerCase().replace(/[\s,]/g, "");
  if (!answers) return null;
  for (let i = 0; i < Math.min(answers.length, key.length); i++) {
    const c = answers[i]!;
    const k = key[i]!;
    const allowed = k.kind === "option" ? LETTERS.slice(0, k.options) : "yn";
    if (c !== "-" && !allowed.includes(c)) return { error: `Q${i + 1}: use ${k.kind === "option" ? `a-${LETTERS[k.options - 1]}` : "y or n"} or -` };
  }
  if (answers.length !== key.length) return { error: `${answers.length} of ${key.length} typed` };
  return { score: key.reduce((n, k, i) => n + (answers[i] === k.expect ? marksPerQuestion : 0), 0) };
}

const written = (key: KeyItem[] | undefined) => (key ?? []).flatMap((k, i) => (k.kind === "mark" ? [i + 1] : []));

export function MarksSheet({ paperId }: { paperId: string }) {
  const units = useApi<{ units: { id: string; name: string }[] }>("/console/org-units");
  const [unitId, setUnitId] = useState("");
  const sheet = useApi<Sheet>(unitId ? `/console/papers/${paperId}/results?unitId=${unitId}` : null);
  const [rows, setRows] = useState<Record<string, { set: PaperSet; answers: string; dirty: boolean }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!sheet.data) return;
    setRows(Object.fromEntries(sheet.data.students.map((s) => [s.id, { set: s.result?.set ?? "A", answers: s.result?.answers ?? "", dirty: false }])));
    setErrors({});
  }, [sheet.data]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const entries = Object.entries(rows)
        .filter(([, r]) => r.dirty)
        .map(([userId, r]) => ({ userId, set: r.set, answers: r.answers }));
      const res = await api<{ saved: number; errors: { userId: string; message: string }[] }>(`/console/papers/${paperId}/results`, { body: { entries } });
      setErrors(Object.fromEntries(res.errors.map((e) => [e.userId, e.message])));
      setMsg(`Saved ${res.saved} result${res.saved === 1 ? "" : "s"}${res.errors.length ? `; ${res.errors.length} need fixing` : ""}. Students are told their marks are in.`);
      const failed = new Set(res.errors.map((e) => e.userId));
      setRows((prev) => Object.fromEntries(Object.entries(prev).map(([id, r]) => [id, { ...r, dirty: failed.has(id) }])));
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const d = sheet.data;
  const dirty = Object.values(rows).filter((r) => r.dirty).length;
  return (
    <div className="card stack">
      <div className="spread wrap">
        <h2 style={{ margin: 0 }}>Enter marks</h2>
        <select aria-label="Batch or section" value={unitId} onChange={(e) => setUnitId(e.target.value)} style={{ width: "auto" }}>
          <option value="">Choose a section</option>
          {units.data?.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        For each student, type one character per question in the order of their set: the letter of the option they chose, y or n for a written answer you marked right or wrong, and - for a blank.
        PlayCode marks it against the set's key.
      </p>
      {d &&
        (["A", "B"] as const)
          .filter((s) => d.format[s])
          .map((s) =>
            written(d.format[s]).length ? (
              <div key={s} className="small">
                {d.paper.sets > 1 ? `Set ${s}: ` : ""}questions {written(d.format[s]).join(", ")} are written answers (y or n).
              </div>
            ) : null,
          )}
      {!unitId ? null : sheet.loading && !d ? (
        <Loading />
      ) : sheet.error || !d ? (
        <ErrorBox message={sheet.error?.message ?? "Could not load"} onRetry={sheet.reload} />
      ) : d.students.length === 0 ? (
        <div className="muted">No students in this section.</div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Roll no</th>
                  <th>Student</th>
                  {d.paper.sets > 1 && <th>Set</th>}
                  <th>Answers ({d.paper.questions})</th>
                  <th>Marks</th>
                </tr>
              </thead>
              <tbody>
                {d.students.map((s) => {
                  const r = rows[s.id] ?? { set: "A" as PaperSet, answers: "", dirty: false };
                  const result = check(d.format[r.set], r.answers, d.paper.marksPerQuestion);
                  const problem = errors[s.id] ?? (result && "error" in result ? result.error : null);
                  const update = (patch: Partial<typeof r>) => setRows({ ...rows, [s.id]: { ...r, ...patch, dirty: true } });
                  return (
                    <tr key={s.id}>
                      <td className="small">{s.rollNo ?? "-"}</td>
                      <td>{s.name}</td>
                      {d.paper.sets > 1 && (
                        <td>
                          <select aria-label={`Set for ${s.name}`} value={r.set} onChange={(e) => update({ set: e.target.value as PaperSet })} style={{ width: "auto" }}>
                            <option value="A">A</option>
                            <option value="B">B</option>
                          </select>
                        </td>
                      )}
                      <td>
                        <input
                          aria-label={`Answers for ${s.name}`}
                          aria-invalid={Boolean(problem)}
                          aria-describedby={problem ? `err-${s.id}` : undefined}
                          value={r.answers}
                          onChange={(e) => update({ answers: e.target.value })}
                          maxLength={200}
                          spellCheck={false}
                          autoComplete="off"
                          placeholder={"-".repeat(Math.min(d.paper.questions, 20))}
                          style={{ fontFamily: "var(--mono)", minWidth: 220, letterSpacing: "0.12em" }}
                        />
                        {problem && (
                          <div id={`err-${s.id}`} className="small" style={{ color: "var(--bad-ink)" }}>
                            {problem}
                          </div>
                        )}
                      </td>
                      <td>{result && "score" in result ? `${result.score}/${d.paper.marks}` : <span className="muted">-</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="spread wrap">
            <span className="small muted" aria-live="polite">
              {msg ?? (dirty ? `${dirty} changed` : "Nothing to save")}
            </span>
            <button className="btn primary" disabled={busy || dirty === 0} onClick={save}>
              {busy ? "Saving..." : "Save marks"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function PaperReport({ paperId }: { paperId: string }) {
  const units = useApi<{ units: { id: string; name: string }[] }>("/console/org-units");
  const [unitId, setUnitId] = useState("");
  const { data, error, loading, reload } = useApi<Report>(`/console/papers/${paperId}/report${unitId ? `?unitId=${unitId}` : ""}`);
  const bands = ["0-19%", "20-39%", "40-59%", "60-79%", "80-100%"];
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <h2 style={{ margin: 0 }}>Results</h2>
        <select aria-label="Results for" value={unitId} onChange={(e) => setUnitId(e.target.value)} style={{ width: "auto" }}>
          <option value="">Everyone in your scope</option>
          {units.data?.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.entered ? (
        <div className="card muted">No marks entered yet.</div>
      ) : (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            <Stat label="Marks entered" value={`${data.entered} of ${data.students}`} />
            <Stat label="Average" value={`${data.average}/${data.paper.marks}`} />
            <Stat label="Highest" value={`${data.highest}`} />
            <Stat label="Lowest" value={`${data.lowest}`} />
          </div>
          <div className="card stack">
            <h3 style={{ margin: 0 }}>Spread of marks</h3>
            {data.distribution.map((n, i) => (
              <div key={bands[i]}>
                <div className="spread small">
                  <span>{bands[i]}</span>
                  <b>{n}</b>
                </div>
                <Bar value={data.entered ? (n / data.entered) * 100 : 0} tone={i >= 3 ? "good" : i === 2 ? "warn" : "bad"} label={`${bands[i]}: ${n} students`} />
              </div>
            ))}
          </div>
          <div className="card stack">
            <h3 style={{ margin: 0 }}>By skill (weakest first)</h3>
            {data.skills.map((s) => (
              <div key={s.id}>
                <div className="spread small">
                  <span>
                    {s.name} <span className="muted">· {s.questions} questions</span>
                  </span>
                  <b>{s.rightPct}% right</b>
                </div>
                <Bar value={s.rightPct} tone={s.rightPct >= 70 ? "good" : s.rightPct >= 40 ? "warn" : "bad"} label={`${s.name}: ${s.rightPct}% right`} />
              </div>
            ))}
            <div className="small muted">Set a catch-up assignment on the weakest skills from Assignments.</div>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Questions, in set A order</caption>
                <thead>
                  <tr>
                    <th>Q (set A)</th>
                    <th>Question</th>
                    <th>Right</th>
                    <th>Blank</th>
                  </tr>
                </thead>
                <tbody>
                  {data.questions.map((q) => (
                    <tr key={q.id}>
                      <td>{q.n}</td>
                      <td className="small">
                        {q.stem}
                        <div className="muted">{q.skill}</div>
                      </td>
                      <td>
                        <span className={`pill ${q.rightPct >= 70 ? "good" : q.rightPct >= 40 ? "warn" : "bad"}`}>{q.rightPct}%</span>
                      </td>
                      <td className="small">{q.blankPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Students, lowest marks first</caption>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Set</th>
                    <th>Marks</th>
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((r) => (
                    <tr key={r.userId}>
                      <td>
                        {r.name} <span className="small muted">{r.rollNo}</span>
                      </td>
                      <td>{r.set}</td>
                      <td>
                        {r.score}/{data.paper.marks} <span className="small muted">({r.pct}%)</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
