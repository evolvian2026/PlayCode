"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState, type FormEvent } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";

interface Summary {
  id: string;
  title: string;
  questions: number;
  durationMinutes: number;
  marks: number;
  sets: number;
  createdAt: string;
  by?: string | null;
}

interface Detail extends Summary {
  instructions: string | null;
  marksPerQuestion: number;
  items: { id: string; type: string; skillId: string; difficulty: number; stem: string }[];
}

interface SkillsData {
  skills: { id: string; name: string; topic: string; available: number }[];
  maxQuestions: number;
}

async function download(paper: Summary, set: "A" | "B", kind: "paper" | "key") {
  const url = await fetchObjectUrl(`/console/papers/${paper.id}/pdf?set=${set}&kind=${kind}`);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${paper.title.replace(/[^\w]+/g, "-").toLowerCase()}${paper.sets > 1 ? `-set-${set.toLowerCase()}` : ""}${kind === "key" ? "-answer-key" : ""}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function PaperView({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, loading, reload } = useApi<Detail>(`/console/papers/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const sets = data.sets > 1 ? (["A", "B"] as const) : (["A"] as const);

  async function get(set: "A" | "B", kind: "paper" | "key") {
    setBusy(`${set}${kind}`);
    setMsg(null);
    try {
      await download(data!, set, kind);
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this paper? Printed copies are unaffected, but you won't be able to download its answer key again.")) return;
    await api(`/console/papers/${id}`, { method: "DELETE" });
    onBack();
  }

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <div>
        <button className="btn ghost small" onClick={onBack}>
          ← All papers
        </button>
        <h1 style={{ margin: "6px 0 0" }}>{data.title}</h1>
        <div className="small muted">
          {data.questions} questions · {data.marks} marks · {data.durationMinutes} minutes{data.sets > 1 ? " · sets A and B" : ""}
        </div>
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Download</h2>
        {sets.map((set) => (
          <div key={set} className="row wrap">
            {data.sets > 1 && <b style={{ minWidth: 48 }}>Set {set}</b>}
            <button className="btn primary small" disabled={busy !== null} onClick={() => get(set, "paper")}>
              {busy === `${set}paper` ? "Preparing..." : "Question paper (PDF)"}
            </button>
            <button className="btn small" disabled={busy !== null} onClick={() => get(set, "key")}>
              {busy === `${set}key` ? "Preparing..." : "Answer key (PDF)"}
            </button>
          </div>
        ))}
        {data.sets > 1 && <div className="small muted">Set B has the same questions with the questions, options and lines in a different order. Each set has its own key.</div>}
        {msg && <ErrorBox message={msg} />}
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Questions</h2>
        <ol style={{ margin: 0, paddingLeft: 22 }} className="stack">
          {data.items.map((q) => (
            <li key={q.id}>
              {q.stem.length > 160 ? `${q.stem.slice(0, 159)}…` : q.stem}
              <div className="small muted">
                {q.type} · {q.skillId} · {["", "easy", "medium", "hard"][q.difficulty]}
              </div>
            </li>
          ))}
        </ol>
      </div>
      <button className="btn danger small" style={{ alignSelf: "flex-start" }} onClick={remove}>
        Delete paper
      </button>
    </div>
  );
}

function Builder({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const { data, error, loading, reload } = useApi<SkillsData>("/console/papers/skills");
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(30);
  const [marks, setMarks] = useState(1);
  const [twoSets, setTwoSets] = useState(true);
  const [instructions, setInstructions] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const topics = useMemo(() => {
    const out = new Map<string, SkillsData["skills"]>();
    for (const s of data?.skills ?? []) out.set(s.topic, [...(out.get(s.topic) ?? []), s]);
    return [...out];
  }, [data]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const picks = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([skillId, count]) => ({ skillId, count }));
      const paper = await api<Detail>("/console/papers", { body: { title, durationMinutes: duration, marksPerQuestion: marks, sets: twoSets ? 2 : 1, instructions: instructions.trim() || null, picks } });
      onCreated(paper.id);
    } catch (err) {
      setMsg(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="stack" style={{ gap: 16, maxWidth: 900 }} onSubmit={submit}>
      <div>
        <button type="button" className="btn ghost small" onClick={onCancel}>
          ← All papers
        </button>
        <h1 style={{ margin: "6px 0 0" }}>New question paper</h1>
        <p className="muted" style={{ margin: 0 }}>
          Choose how many questions to take from each skill. PlayCode picks them from the question bank (multiple choice and short answers; coding problems stay online) and prints the paper and its answer key.
        </p>
      </div>
      <div className="card stack">
        <label className="stack" style={{ gap: 4 }}>
          <b className="small">Title</b>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="CSE 2027 unit test 2: aptitude and DBMS" maxLength={120} required />
        </label>
        <div className="row wrap">
          <label className="stack" style={{ gap: 4 }}>
            <b className="small">Minutes</b>
            <input type="number" min={5} max={240} value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={{ width: 110 }} />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <b className="small">Marks per question</b>
            <input type="number" min={1} max={10} value={marks} onChange={(e) => setMarks(Number(e.target.value))} style={{ width: 110 }} />
          </label>
          <label className="row" style={{ gap: 8, alignSelf: "flex-end", paddingBottom: 8 }}>
            <input type="checkbox" checked={twoSets} onChange={(e) => setTwoSets(e.target.checked)} style={{ width: "auto" }} />
            Two sets (A and B) so neighbours can't copy
          </label>
        </div>
        <label className="stack" style={{ gap: 4 }}>
          <b className="small">Instructions (optional)</b>
          <textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={1000} placeholder="Answer all questions. No negative marking. Circle the letter of the option you choose." />
        </label>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Skill</th>
                <th>In the bank</th>
                <th>Questions</th>
              </tr>
            </thead>
            {topics.map(([topic, list]) => (
              <tbody key={topic}>
                <tr>
                  <th colSpan={3} scope="colgroup" style={{ background: "var(--surface-2)" }}>
                    {topic}
                  </th>
                </tr>
                {list.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="small muted">{s.available}</td>
                    <td>
                      <input
                        type="number"
                        aria-label={`Questions from ${topic}: ${s.name}`}
                        min={0}
                        max={s.available}
                        value={counts[s.id] ?? 0}
                        onChange={(e) => setCounts({ ...counts, [s.id]: Math.max(0, Math.min(s.available, Number(e.target.value) || 0)) })}
                        style={{ width: 80 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </div>
      {msg && <ErrorBox message={msg} />}
      <div className="spread wrap" style={{ position: "sticky", bottom: 0, background: "var(--bg)", padding: "8px 0" }}>
        <span className={total > data.maxQuestions ? "" : "muted"} style={total > data.maxQuestions ? { color: "var(--bad-ink)" } : undefined} aria-live="polite">
          {total} questions · {total * marks} marks{total > data.maxQuestions ? ` (at most ${data.maxQuestions})` : ""}
        </span>
        <button className="btn primary" disabled={busy || total === 0 || total > data.maxQuestions || title.trim().length < 3}>
          {busy ? "Building..." : "Build paper"}
        </button>
      </div>
    </form>
  );
}

function Papers() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id");
  const creating = params.get("new") === "1";
  const list = useApi<{ papers: Summary[] }>(id || creating ? null : "/console/papers");
  const back = () => router.push("/console/papers");
  if (creating) return <Builder onCreated={(pid) => router.replace(`/console/papers?id=${pid}`)} onCancel={back} />;
  if (id) return <PaperView id={id} onBack={back} />;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>Question papers</h1>
          <p className="muted" style={{ margin: 0 }}>
            Class tests on paper, built from the question bank, with answer keys. For labs without enough computers, or a quick test in class.
          </p>
        </div>
        <button className="btn primary" onClick={() => router.push("/console/papers?new=1")}>
          New paper
        </button>
      </div>
      {list.error && <ErrorBox message={list.error.message} onRetry={list.reload} />}
      {list.loading && !list.data ? (
        <Loading />
      ) : !list.data?.papers.length ? (
        <div className="card muted">No papers yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Paper</th>
                  <th>Questions</th>
                  <th>Marks</th>
                  <th>Minutes</th>
                  <th>By</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {list.data.papers.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <a
                        href={`/console/papers?id=${p.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          router.push(`/console/papers?id=${p.id}`);
                        }}
                      >
                        {p.title}
                      </a>
                      {p.sets > 1 && <span className="small muted"> · sets A, B</span>}
                    </td>
                    <td>{p.questions}</td>
                    <td>{p.marks}</td>
                    <td>{p.durationMinutes}</td>
                    <td className="small">{p.by ?? "-"}</td>
                    <td className="small">{new Date(p.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</td>
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

export default function PapersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Papers />
    </Suspense>
  );
}
