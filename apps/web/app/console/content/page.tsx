"use client";

import { useState } from "react";
import { describeAnswer, QUESTION_TYPE_LABELS, QUESTION_TYPES, type Answer, type QuestionBody, type QuestionType } from "@playcode/core";
import { CodeBlock } from "@/components/CodeBlock";
import { ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";

interface Q {
  id: string;
  type: QuestionType;
  skillId: string;
  language: string;
  difficulty: 1 | 2 | 3;
  body: QuestionBody;
  answer: Answer;
  explanation: string;
  attempts: number;
  accuracyPct: number | null;
  owner: "playcode" | "institution";
}

const DIFF = ["", "Easy", "Medium", "Hard"];

export default function Content() {
  const [skillId, setSkillId] = useState("");
  const [type, setType] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const skills = useApi<{ skills: { id: string; name: string; topicName: string }[] }>("/console/skills");
  const params = new URLSearchParams({ ...(skillId ? { skillId } : {}), ...(type ? { type } : {}) }).toString();
  const { data, error, loading, reload } = useApi<{ questions: Q[] }>(`/console/questions${params ? `?${params}` : ""}`);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>Question bank</h1>
          <p className="muted" style={{ margin: 0 }}>
            PlayCode content, checked by running every snippet. Accuracy updates as students answer.
          </p>
        </div>
        <div className="row">
          <select value={skillId} onChange={(e) => setSkillId(e.target.value)} aria-label="Skill">
            <option value="">All skills</option>
            {skills.data?.skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.topicName}: {s.name}
              </option>
            ))}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Question type">
            <option value="">All types</option>
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {QUESTION_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : (
        <>
          <p className="muted small">{data?.questions.length} questions</p>
          {data?.questions.map((q) => (
            <div key={q.id} className="card stack" style={{ gap: 8 }}>
              <button
                className="spread"
                style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left" }}
                onClick={() => setOpen(open === q.id ? null : q.id)}
                aria-expanded={open === q.id}
              >
                <span>
                  <b>{q.body.stem}</b>
                  <span className="muted small">
                    {" "}
                    · {q.skillId} · {q.id}
                  </span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <span className="pill accent">{QUESTION_TYPE_LABELS[q.type]}</span>
                  <span className="pill">{q.language}</span>
                  <span className="pill">{DIFF[q.difficulty]}</span>
                  <span className="pill">{q.accuracyPct === null ? "no attempts" : `${q.accuracyPct}% of ${q.attempts}`}</span>
                </span>
              </button>
              {open === q.id && (
                <div className="stack">
                  {q.body.code && <CodeBlock code={q.body.code} />}
                  {q.body.options && (
                    <ol className="small" style={{ margin: 0 }}>
                      {q.body.options.map((o) => (
                        <li key={o.id} style={{ fontWeight: q.answer.kind === "option" && q.answer.optionId === o.id ? 700 : 400 }}>
                          <pre style={{ margin: 0, fontFamily: "var(--mono)", whiteSpace: "pre-wrap" }}>{o.text}</pre>
                        </li>
                      ))}
                    </ol>
                  )}
                  <div className="feedback right">
                    <div className="small muted">Answer</div>
                    <pre>{describeAnswer(q)}</pre>
                    <p style={{ margin: 0 }}>{q.explanation}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
