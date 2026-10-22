"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { QUESTION_TYPE_LABELS, type QuestionType } from "@playcode/core";
import { CodeBlock } from "@/components/CodeBlock";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { DRAFT_STORAGE_KEY, type QuestionCheck, type StudioInput, type StudioQuestion } from "@/lib/studio";

interface StudioInfo {
  bank: "institution" | "global";
  ai: boolean;
  draftable: QuestionType[];
}

type Skill = { id: string; name: string; topicName: string };

const STATUS_TONE: Record<StudioQuestion["status"], string> = { draft: "warn", live: "good", retired: "" };
const DIFF = ["", "Easy", "Medium", "Hard"];

function CheckBadge({ check }: { check: QuestionCheck | null }) {
  if (!check) return <span className="pill">Not checked</span>;
  return check.ok ? <span className="pill good">Check passed</span> : <span className="pill bad">Check failed</span>;
}

function AiDrafts({ info, skills }: { info: StudioInfo; skills: Skill[] }) {
  const router = useRouter();
  const [type, setType] = useState<QuestionType>(info.draftable[0] ?? "predict_output");
  const [skillId, setSkillId] = useState(skills[0]?.id ?? "");
  const [language, setLanguage] = useState("python");
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(1);
  const [count, setCount] = useState(3);
  const [guidance, setGuidance] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<{ input: StudioInput; check: QuestionCheck; saved?: string }[]>([]);

  async function draft() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ drafts: { input: StudioInput; check: QuestionCheck }[] }>("/console/studio/draft", {
        body: { type, skillId, language, difficulty, count, guidance: guidance.trim() || undefined },
      });
      setDrafts(res.drafts);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function open(input: StudioInput) {
    try {
      sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(input));
    } catch {
      // Storage blocked: the editor opens empty.
    }
    router.push("/console/studio/edit");
  }

  async function save(i: number) {
    try {
      const { question } = await api<{ question: StudioQuestion }>("/console/studio/questions", { body: drafts[i]!.input });
      setDrafts((d) => d.map((x, j) => (j === i ? { ...x, saved: question.id } : x)));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Draft with AI</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Claude writes a few questions for you to review. Each draft is checked straight away (code is run where possible); nothing reaches students until you
        publish it.
      </p>
      <div className="row wrap" style={{ alignItems: "flex-end" }}>
        <div>
          <label htmlFor="ai-type">Type</label>
          <select id="ai-type" value={type} onChange={(e) => setType(e.target.value as QuestionType)}>
            {info.draftable.map((t) => (
              <option key={t} value={t}>
                {QUESTION_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="ai-skill">Skill</label>
          <select id="ai-skill" value={skillId} onChange={(e) => setSkillId(e.target.value)}>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.topicName}: {s.name}
              </option>
            ))}
          </select>
        </div>
        {type !== "write_code" && type !== "sql_query" && (
        <div>
          <label htmlFor="ai-lang">Language</label>
          <select id="ai-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="python">Python</option>
            <option value="c">C</option>
            <option value="java">Java</option>
            <option value="pseudocode">Pseudocode</option>
          </select>
        </div>
        )}
        <div>
          <label htmlFor="ai-diff">Difficulty</label>
          <select id="ai-diff" value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value) as 1 | 2 | 3)}>
            <option value={1}>Easy</option>
            <option value={2}>Medium</option>
            <option value={3}>Hard</option>
          </select>
        </div>
        <div>
          <label htmlFor="ai-count">How many</label>
          <select id="ai-count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>
      <input aria-label="Notes for the AI" placeholder="Notes (optional), e.g. use off-by-one errors, TCS NQT style" value={guidance} onChange={(e) => setGuidance(e.target.value)} maxLength={1000} />
      <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy || !skillId} onClick={draft}>
        {busy ? (type === "write_code" ? "Drafting and running solutions (a few minutes)..." : "Drafting (this can take a minute)...") : "Draft questions"}
      </button>
      {error && <ErrorBox message={error} />}
      {drafts.map((d, i) => (
        <div key={i} className="card stack" style={{ gap: 8, background: "var(--surface-2)" }}>
          <div className="spread">
            <b>{d.input.body.stem}</b>
            {d.check.ok ? <span className="pill good">Check passed</span> : <span className="pill bad">Needs fixing</span>}
          </div>
          {d.input.body.code && <CodeBlock code={d.input.body.code} />}
          {d.input.answer.kind === "tests" && (
            <div className="small">
              {d.input.answer.tests.length} tests ({d.input.answer.tests.filter((x) => !x.hidden).length} shown to students) · solutions in{" "}
              {Object.keys(d.input.solutions ?? {}).join(", ")} · expected outputs come from running the Python solution
            </div>
          )}
          {d.input.answer.kind === "sql" && (
            <>
              <CodeBlock code={d.input.body.schema ?? ""} />
              <div className="small">Model query:</div>
              <CodeBlock code={d.input.answer.solution} />
            </>
          )}
          {d.input.body.options && (
            <ol className="small" style={{ margin: 0, paddingLeft: 18 }} type="a">
              {d.input.body.options.map((o) => (
                <li key={o.id} style={{ fontWeight: d.input.answer.kind === "option" && d.input.answer.optionId === o.id ? 700 : 400 }}>
                  {o.text}
                </li>
              ))}
            </ol>
          )}
          {d.input.answer.kind === "text" && <div className="small">Answer: {d.input.answer.accepted.join(" / ")}</div>}
          {d.input.answer.kind === "lines" && <div className="small">Faulty line: {d.input.answer.lines.join(", ")}</div>}
          {d.check.problems.map((p) => (
            <div key={p} className="small" style={{ color: "var(--bad)" }}>
              {p}
            </div>
          ))}
          <div className="row">
            <button className="btn small" onClick={() => open(d.input)}>
              Edit and review
            </button>
            {d.saved ? (
              <Link className="btn small ghost" href={`/console/studio/edit?id=${d.saved}`}>
                Saved as draft. Open
              </Link>
            ) : (
              <button className="btn small ghost" onClick={() => save(i)}>
                Save as draft
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Studio() {
  const [status, setStatus] = useState("");
  const [skillId, setSkillId] = useState("");
  const [search, setSearch] = useState("");
  const [showAi, setShowAi] = useState(false);
  const info = useApi<StudioInfo>("/console/studio");
  const skills = useApi<{ skills: Skill[] }>("/console/skills");
  const params = new URLSearchParams({ ...(status ? { status } : {}), ...(skillId ? { skillId } : {}), ...(search.trim() ? { search: search.trim() } : {}) }).toString();
  const { data, error, loading, reload } = useApi<{ questions: StudioQuestion[] }>(`/console/studio/questions${params ? `?${params}` : ""}`);

  if (info.error) return <ErrorBox message={info.error.message} onRetry={info.reload} />;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>Content studio</h1>
          <p className="muted" style={{ margin: 0 }}>
            {info.data?.bank === "global"
              ? "The PlayCode question bank, used by every institution."
              : "Your institution's own questions. Only your students see them, alongside the PlayCode bank."}
          </p>
        </div>
        <div className="row">
          {info.data?.ai && (
            <button className="btn" onClick={() => setShowAi((v) => !v)} aria-expanded={showAi}>
              Draft with AI
            </button>
          )}
          <Link className="btn primary" href="/console/studio/edit">
            New question
          </Link>
        </div>
      </div>
      {showAi && info.data && skills.data && <AiDrafts info={info.data} skills={skills.data.skills} />}
      <div className="row wrap">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: "auto" }}>
          <option value="">Any status</option>
          <option value="draft">Drafts</option>
          <option value="live">Live</option>
          <option value="retired">Retired</option>
        </select>
        <select aria-label="Skill" value={skillId} onChange={(e) => setSkillId(e.target.value)} style={{ width: "auto" }}>
          <option value="">All skills</option>
          {skills.data?.skills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.topicName}: {s.name}
            </option>
          ))}
        </select>
        <input aria-label="Search" placeholder="Search questions" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
      </div>
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data?.questions.length === 0 ? (
        <div className="card muted">No questions yet. Write one, or draft a few with AI.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Check</th>
                  <th>Answered</th>
                </tr>
              </thead>
              <tbody>
                {data?.questions.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <Link href={`/console/studio/edit?id=${q.id}`}>{q.body.stem.length > 90 ? `${q.body.stem.slice(0, 90)}...` : q.body.stem}</Link>
                      <div className="small muted">
                        {q.skillId} · {DIFF[q.difficulty]} · {q.language}
                        {q.origin === "ai" && " · AI-drafted"}
                      </div>
                    </td>
                    <td className="small">{q.typeLabel}</td>
                    <td>
                      <span className={`pill ${STATUS_TONE[q.status]}`}>{q.status}</span>
                    </td>
                    <td>
                      <CheckBadge check={q.lastCheck} />
                    </td>
                    <td className="small">{q.attempts ? `${q.attempts} (${q.accuracyPct}% right)` : "-"}</td>
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
