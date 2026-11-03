"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ErrorBox, formatDate, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface QuizRow {
  id: string;
  title: string;
  code: string;
  status: "lobby" | "question" | "reveal" | "ended";
  questions: number;
  players: number;
  createdAt: string;
}

export default function LiveQuizzes() {
  const router = useRouter();
  const list = useApi<{ quizzes: QuizRow[] }>("/console/live");
  const missions = useApi<{ packs: { id: string; title: string; kind: string }[] }>("/console/packs");
  const skills = useApi<{ skills: { id: string; name: string; topicName: string }[] }>("/console/skills");
  const [f, setF] = useState({ title: "", source: "", count: 10, seconds: 20 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const [kind, ref] = f.source.split(":");
    try {
      const { id } = await api<{ id: string }>("/console/live", {
        body: { title: f.title, count: f.count, secondsPerQuestion: f.seconds, ...(kind === "pack" ? { packId: ref } : { skillId: ref }) },
      });
      router.push(`/console/live/${id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <h1 style={{ margin: 0 }}>Live quiz</h1>
        <p className="muted" style={{ margin: 0 }}>
          Run a quiz in class: put this screen on the projector, students join on their phones with a code, and points go to the fastest right answers.
        </p>
      </div>
      <form className="card stack" onSubmit={create}>
        <div className="row wrap">
          <div style={{ flex: 2, minWidth: 220 }}>
            <label htmlFor="lq-title">Title</label>
            <input id="lq-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required minLength={2} maxLength={120} placeholder="Loops warm-up" />
          </div>
          <div style={{ flex: 2, minWidth: 220 }}>
            <label htmlFor="lq-source">Questions from</label>
            <select id="lq-source" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} required>
              <option value="">Choose a mission or a skill</option>
              <optgroup label="Missions">
                {(missions.data?.packs ?? []).filter((m) => m.kind === "mission").map((m) => (
                  <option key={m.id} value={`pack:${m.id}`}>
                    {m.title}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Skills (random questions)">
                {(skills.data?.skills ?? []).map((s) => (
                  <option key={s.id} value={`skill:${s.id}`}>
                    {s.topicName}: {s.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <div style={{ width: 120 }}>
            <label htmlFor="lq-count">Questions</label>
            <input id="lq-count" type="number" min={1} max={30} value={f.count} onChange={(e) => setF({ ...f, count: Number(e.target.value) })} />
          </div>
          <div style={{ width: 140 }}>
            <label htmlFor="lq-seconds">Seconds each</label>
            <input id="lq-seconds" type="number" min={10} max={120} value={f.seconds} onChange={(e) => setF({ ...f, seconds: Number(e.target.value) })} />
          </div>
        </div>
        {error && <ErrorBox message={error} />}
        <button className="btn primary" disabled={busy} style={{ alignSelf: "flex-start" }}>
          {busy ? "Creating..." : "Create and open"}
        </button>
      </form>
      {list.loading && !list.data ? (
        <Loading />
      ) : (
        (list.data?.quizzes.length ?? 0) > 0 && (
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Quiz</th>
                    <th>Created</th>
                    <th>Questions</th>
                    <th>Players</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data!.quizzes.map((q) => (
                    <tr key={q.id}>
                      <td>
                        <Link href={`/console/live/${q.id}`}>{q.title}</Link>
                      </td>
                      <td className="small">{formatDate(q.createdAt)}</td>
                      <td>{q.questions}</td>
                      <td>{q.players}</td>
                      <td>
                        <span className={`pill ${q.status === "ended" ? "" : "good"}`}>{q.status === "ended" ? "Finished" : `Open · code ${q.code}`}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}
