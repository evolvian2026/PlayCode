"use client";

import Link from "next/link";
import { useState, type ChangeEvent } from "react";
import { ErrorBox } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

interface Result {
  index: number;
  id: string | null;
  ok: boolean;
  problems: string[];
}

const EXAMPLE = `[
  {
    "type": "predict_output",
    "skillId": "loops.for",
    "difficulty": 1,
    "body": { "stem": "What does this print?", "code": "for i in range(3):\\n    print(i * 2, end=' ')", "language": "python" },
    "answer": { "kind": "text", "accepted": ["0 2 4"] },
    "explanation": "i takes 0, 1, 2, so it prints 0 2 4.",
    "hints": ["range(3) starts at 0."],
    "checkMode": "run"
  }
]`;

export default function ImportQuestions() {
  const [text, setText] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<string | null>(null);

  async function file(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setText(await f.text());
  }

  async function run() {
    setError(null);
    setPublished(null);
    let questions: unknown;
    try {
      questions = JSON.parse(text);
    } catch {
      setError("That isn't valid JSON. Paste an array of questions in the format shown.");
      return;
    }
    if (!Array.isArray(questions)) {
      setError("Paste an array of questions: [ {...}, {...} ]");
      return;
    }
    setBusy(true);
    try {
      setResults((await api<{ results: Result[] }>("/console/studio/import", { body: { questions } })).results);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    const ids = results!.filter((r) => r.ok && r.id).map((r) => r.id!);
    try {
      const res = await api<{ published: string[]; failed: { id: string }[] }>("/console/studio/publish", { body: { ids } });
      setPublished(`Published ${res.published.length} questions.${res.failed.length ? ` ${res.failed.length} could not be published.` : ""}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const passed = results?.filter((r) => r.ok).length ?? 0;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <Link href="/console/studio" className="small muted">
          Content studio
        </Link>
        <h1 style={{ margin: 0 }}>Import questions</h1>
        <p className="muted" style={{ margin: 0 }}>
          Up to 200 questions at a time, as JSON in the studio&apos;s format. Each is saved as a draft and checked (code is run) exactly as in the editor; publish the ones
          that pass, and fix the rest in the editor.
        </p>
      </div>
      <div className="card stack">
        <input type="file" accept="application/json,.json" aria-label="JSON file" onChange={file} />
        <textarea aria-label="Questions (JSON)" rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} style={{ fontFamily: "var(--mono)", fontSize: 13 }} />
        {error && <ErrorBox message={error} />}
        <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy || !text.trim()} onClick={run}>
          {busy ? "Importing and checking..." : "Import and check"}
        </button>
      </div>
      {results && (
        <div className="card stack">
          <div className="spread wrap">
            <h2 style={{ margin: 0 }}>
              {passed} of {results.length} passed their check
            </h2>
            {passed > 0 && !published && (
              <button className="btn primary small" onClick={publish}>
                Publish the {passed} that passed
              </button>
            )}
            {published && <span className="pill good">{published}</span>}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Result</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.index}>
                    <td>{r.index + 1}</td>
                    <td>{r.ok ? <span className="pill good">Passed</span> : r.id ? <span className="pill warn">Saved, check failed</span> : <span className="pill bad">Not saved</span>}</td>
                    <td className="small">
                      {r.id && (
                        <Link href={`/console/studio/edit?id=${encodeURIComponent(r.id)}`} style={{ marginRight: 8 }}>
                          Open
                        </Link>
                      )}
                      {r.problems.join("; ")}
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
