"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  ANSWER_KIND_BY_TYPE,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  responseKindFor,
  toStudentView,
  type Answer,
  type CodeLanguage,
  type QuestionBody,
  type QuestionType,
} from "@playcode/core";
import { CodeEditor } from "@/components/CodeEditor";
import { emptyDraft, QuestionInput, type Draft } from "@/components/QuestionInput";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { blankAnswer, blankInput, DRAFT_STORAGE_KEY, optionId, type QuestionCheck, toInput, type StudioInput, type StudioQuestion } from "@/lib/studio";
import type { QuestionView } from "@/lib/types";

const CODE_LANGS: CodeLanguage[] = ["python", "c", "java"];
const LANG_LABEL: Record<string, string> = { python: "Python", c: "C", java: "Java", pseudocode: "Pseudocode", sql: "SQL", theory: "Concepts (no code)" };
const editorLang = (l: string) => (l === "c" || l === "java" || l === "python" || l === "sql" ? l : "python");
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

function CheckResult({ check }: { check: QuestionCheck }) {
  return (
    <div className={check.ok ? "card tight" : "error"} role="status" style={check.ok ? { background: "var(--good-soft)", borderColor: "transparent" } : undefined}>
      <b>{check.ok ? "Check passed" : "Check failed"}</b>
      {check.problems.length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {check.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {check.output !== undefined && (
        <div className="small" style={{ marginTop: 6 }}>
          Program output: <code className="inline-code">{check.output || "(nothing)"}</code>
        </div>
      )}
    </div>
  );
}

function Preview({ input }: { input: StudioInput }) {
  const view: QuestionView = useMemo(
    () => ({
      ...toStudentView({ id: "preview", type: input.type, skillId: input.skillId, difficulty: input.difficulty, body: input.body, answer: input.answer, explanation: input.explanation, hints: input.hints }, "preview"),
      hintsUsed: 0,
      coachUsed: 0,
    }),
    [input],
  );
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(view));
  useEffect(() => setDraft(emptyDraft(view)), [view.responseKind, input.type]);
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="small muted">Student preview</div>
      <b style={{ whiteSpace: "pre-line" }}>{input.body.stem || "Your question appears here"}</b>
      <QuestionInput key={`${input.type}-${view.responseKind}`} question={view} draft={draft} onChange={setDraft} onSubmit={() => {}} answer={null} />
    </div>
  );
}

function Editor() {
  const router = useRouter();
  const id = useSearchParams().get("id");
  const skills = useApi<{ skills: { id: string; name: string; topicName: string }[] }>("/console/skills");
  const [saved, setSaved] = useState<StudioQuestion | null>(null);
  const [input, setInput] = useState<StudioInput | null>(null);
  // Remount the code editors when a different question loads (they are uncontrolled after mount).
  const [loadKey, setLoadKey] = useState(0);
  const [check, setCheck] = useState<QuestionCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (id) {
      api<{ question: StudioQuestion }>(`/console/studio/questions/${encodeURIComponent(id)}`)
        .then(({ question }) => {
          setSaved(question);
          setInput(toInput(question));
          setCheck(question.lastCheck);
          setLoadKey((k) => k + 1);
        })
        .catch((e) => setError(errorMessage(e)));
      return;
    }
    let fromAi: StudioInput | null = null;
    try {
      const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        fromAi = JSON.parse(raw) as StudioInput;
        sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      }
    } catch {
      // Storage blocked: start blank.
    }
    setSaved(null);
    setInput(fromAi ?? blankInput());
    setCheck(null);
    setLoadKey((k) => k + 1);
  }, [id]);

  useEffect(() => {
    if (input && !input.skillId && skills.data?.skills[0]) setInput({ ...input, skillId: skills.data.skills[0].id });
  }, [skills.data, input]);

  if (error && !input) return <ErrorBox message={error} />;
  if (!input) return <Loading />;

  const set = (patch: Partial<StudioInput>) => setInput({ ...input, ...patch });
  const setBody = (patch: Partial<QuestionBody>) => setInput({ ...input, body: { ...input.body, ...patch } });
  const setAnswer = (answer: Answer) => setInput({ ...input, answer });
  const kinds = ANSWER_KIND_BY_TYPE[input.type];
  const a = input.answer;
  const runnable = !["write_code", "sql_query"].includes(input.type);
  const codeLang = input.body.language === "sql" || input.body.language === "pseudocode" ? input.body.language : input.body.language;

  function changeType(type: QuestionType) {
    const next = blankInput(type, input!.skillId);
    // Keep what carries over: stem, code, explanation, hints, tags, difficulty.
    setInput({ ...next, difficulty: input!.difficulty, explanation: input!.explanation, hints: input!.hints, tags: input!.tags, body: { ...next.body, stem: input!.body.stem, ...(input!.body.code && type !== "write_code" && type !== "sql_query" ? { code: input!.body.code } : {}) } });
    setLoadKey((k) => k + 1);
  }

  function changeAnswerKind(kind: Answer["kind"]) {
    const answer = blankAnswer(input!.type, kind);
    setInput({ ...input!, answer, body: { ...input!.body, ...(kind === "option" && !input!.body.options ? { options: [0, 1, 2, 3].map((i) => ({ id: optionId(i), text: "" })) } : {}) } });
  }

  async function runCheck() {
    setBusy(true);
    setError(null);
    try {
      setCheck((await api<{ check: QuestionCheck }>("/console/studio/check", { body: input })).check);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function save(publish = false) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      let q = saved
        ? (await api<{ question: StudioQuestion }>(`/console/studio/questions/${saved.id}`, { method: "PUT", body: input })).question
        : (await api<{ question: StudioQuestion }>("/console/studio/questions", { body: input })).question;
      if (publish) q = (await api<{ question: StudioQuestion }>(`/console/studio/questions/${q.id}/status`, { body: { status: "live" } })).question;
      setSaved(q);
      setCheck(q.lastCheck ?? check);
      setMsg(publish ? "Published. Students can get this question now." : "Saved.");
      if (!saved) router.replace(`/console/studio/edit?id=${q.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function retire() {
    if (!saved || !window.confirm("Retire this question? Students stop getting it; past answers are kept.")) return;
    try {
      setSaved((await api<{ question: StudioQuestion }>(`/console/studio/questions/${saved.id}/status`, { body: { status: "retired" } })).question);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  // Parsons: solution lines (in order) and distractors are edited as text.
  const parsonsLines = input.body.lines ?? [];
  const solutionIds = a.kind === "order" ? (a.orders[0] ?? []) : [];
  const solutionText = solutionIds.map((sid) => parsonsLines.find((l) => l.id === sid)?.text ?? "").join("\n");
  const distractorText = parsonsLines.filter((l) => !solutionIds.includes(l.id)).map((l) => l.text).join("\n");
  function setParsons(solution: string, distractors: string) {
    const sol = solution.split("\n").filter((l) => l.trim());
    const dis = distractors.split("\n").filter((l) => l.trim());
    const all = [...sol, ...dis].map((text, i) => ({ id: `l${i + 1}`, text }));
    setInput({ ...input!, body: { ...input!.body, lines: all }, answer: { kind: "order", orders: [all.slice(0, sol.length).map((l) => l.id)] } });
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <Link href="/console/studio" className="small muted">
            Content studio
          </Link>
          <h1 style={{ margin: 0 }}>{saved ? "Edit question" : "New question"}</h1>
          {saved && (
            <div className="small muted">
              {saved.id} · version {saved.version} · <span className={`pill ${saved.status === "live" ? "good" : saved.status === "draft" ? "warn" : ""}`}>{saved.status}</span>
              {saved.origin === "ai" && " · AI-drafted"}
            </div>
          )}
          {!saved && input.origin === "ai" && <div className="small muted">AI draft: review every part before publishing.</div>}
        </div>
      </div>

      <div className="studio-grid">
        <div className="stack" style={{ gap: 14 }}>
          <div className="card stack">
            <div className="row wrap">
              <div style={{ flex: 1, minWidth: 180 }}>
                <label htmlFor="q-type">Type</label>
                <select id="q-type" value={input.type} onChange={(e) => changeType(e.target.value as QuestionType)}>
                  {QUESTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {QUESTION_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 2, minWidth: 220 }}>
                <label htmlFor="q-skill">Skill</label>
                <select id="q-skill" value={input.skillId} onChange={(e) => set({ skillId: e.target.value })}>
                  {skills.data?.skills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.topicName}: {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="q-diff">Difficulty</label>
                <select id="q-diff" value={input.difficulty} onChange={(e) => set({ difficulty: Number(e.target.value) as 1 | 2 | 3 })}>
                  <option value={1}>Easy</option>
                  <option value={2}>Medium</option>
                  <option value={3}>Hard</option>
                </select>
              </div>
              {input.type !== "sql_query" && input.type !== "write_code" && (
                <div>
                  <label htmlFor="q-lang">Language</label>
                  <select id="q-lang" value={input.body.language} onChange={(e) => setBody({ language: e.target.value as QuestionBody["language"] })}>
                    {["python", "c", "java", "pseudocode", "theory"].map((l) => (
                      <option key={l} value={l}>
                        {LANG_LABEL[l]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="q-stem">Question</label>
              <textarea id="q-stem" rows={3} value={input.body.stem} onChange={(e) => setBody({ stem: e.target.value })} placeholder="What does this program print?" />
              <div className="small muted">Wrap code in `backticks` for inline code.</div>
            </div>
            {input.type !== "write_code" && input.type !== "sql_query" && (
              <div>
                <label>Code {input.type === "which_snippet" ? "(optional)" : ""}</label>
                <CodeEditor key={`code-${loadKey}-${codeLang}`} language={editorLang(codeLang)} value={input.body.code ?? ""} onChange={(code) => setBody({ code })} minHeight={160} label="Question code" />
              </div>
            )}
          </div>

          <div className="card stack">
            <div className="spread">
              <h2 style={{ margin: 0 }}>Answer</h2>
              {kinds.length > 1 && (
                <select aria-label="Answer format" value={a.kind} onChange={(e) => changeAnswerKind(e.target.value as Answer["kind"])} style={{ width: "auto" }}>
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {k === "option" ? "Multiple choice" : "Typed answer"}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {a.kind === "option" && (
              <div className="stack" style={{ gap: 8 }}>
                {(input.body.options ?? []).map((o, i) => (
                  <div key={o.id} className="row" style={{ alignItems: "flex-start" }}>
                    <input type="radio" name="correct" aria-label={`Option ${o.id} is correct`} checked={a.optionId === o.id} onChange={() => setAnswer({ kind: "option", optionId: o.id })} style={{ width: "auto", marginTop: 12 }} />
                    <textarea
                      aria-label={`Option ${o.id}`}
                      rows={o.code ? 3 : 1}
                      value={o.text}
                      className={o.code ? "mono" : ""}
                      onChange={(e) => setBody({ options: input.body.options!.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })}
                    />
                    <button
                      className="btn ghost small"
                      aria-label={`Remove option ${o.id}`}
                      disabled={(input.body.options?.length ?? 0) <= 2}
                      onClick={() => {
                        const options = input.body.options!.filter((_, j) => j !== i).map((x, j) => ({ ...x, id: optionId(j) }));
                        setInput({ ...input, body: { ...input.body, options }, answer: { kind: "option", optionId: "a" } });
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <div className="row">
                  <button className="btn small" disabled={(input.body.options?.length ?? 0) >= 6} onClick={() => setBody({ options: [...(input.body.options ?? []), { id: optionId(input.body.options?.length ?? 0), text: "", ...(input.type === "which_snippet" || input.type === "reverse_mode" ? { code: true } : {}) }] })}>
                    Add option
                  </button>
                  <span className="small muted">Select the correct option. Students see options shuffled.</span>
                </div>
              </div>
            )}

            {a.kind === "text" && (
              <div>
                <label htmlFor="q-accepted">Accepted answers, one per line</label>
                <textarea id="q-accepted" rows={3} value={a.accepted.join("\n")} onChange={(e) => setAnswer({ ...a, accepted: e.target.value.split("\n") })} />
                <div className="small muted">Spaces and line breaks are ignored when marking. For program output, write lines separated by spaces.</div>
                <label className="row" style={{ gap: 6, fontWeight: 500 }}>
                  <input type="checkbox" checked={Boolean(a.caseSensitive)} onChange={(e) => setAnswer({ ...a, caseSensitive: e.target.checked })} style={{ width: "auto" }} /> Case matters
                </label>
              </div>
            )}

            {a.kind === "lines" && (
              <div>
                <label htmlFor="q-lines">Faulty line numbers</label>
                <input id="q-lines" value={a.lines.join(", ")} onChange={(e) => setAnswer({ kind: "lines", lines: e.target.value.split(/[^\d]+/).filter(Boolean).map(Number) })} placeholder="e.g. 4" />
              </div>
            )}

            {a.kind === "order" && (
              <div className="row wrap" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <label htmlFor="q-sol">Lines in the correct order</label>
                  <textarea id="q-sol" rows={6} className="mono" value={solutionText} onChange={(e) => setParsons(e.target.value, distractorText)} />
                </div>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <label htmlFor="q-dis">Distractor lines (optional)</label>
                  <textarea id="q-dis" rows={6} className="mono" value={distractorText} onChange={(e) => setParsons(solutionText, e.target.value)} />
                </div>
              </div>
            )}

            {a.kind === "tests" && (
              <div className="stack">
                <div className="row wrap">
                  <span className="small">Languages students may use:</span>
                  {CODE_LANGS.map((l) => (
                    <label key={l} className="row" style={{ gap: 4, fontWeight: 500 }}>
                      <input
                        type="checkbox"
                        style={{ width: "auto" }}
                        checked={input.body.languages?.includes(l) ?? false}
                        onChange={(e) => {
                          const languages = e.target.checked ? [...(input.body.languages ?? []), l] : (input.body.languages ?? []).filter((x) => x !== l);
                          setInput({ ...input, body: { ...input.body, languages, language: languages[0] ?? "python" } });
                        }}
                      />
                      {LANG_LABEL[l]}
                    </label>
                  ))}
                </div>
                <div className="small muted">Tests feed stdin and compare stdout. Students see sample tests; hidden tests decide the mark.</div>
                {a.tests.map((tc, i) => (
                  <div key={i} className="row wrap" style={{ alignItems: "flex-start" }}>
                    <textarea aria-label={`Test ${i + 1} input`} rows={2} className="mono" placeholder="stdin" value={tc.input} onChange={(e) => setAnswer({ ...a, tests: a.tests.map((x, j) => (j === i ? { ...x, input: e.target.value } : x)) })} style={{ flex: 1, minWidth: 160 }} />
                    <textarea aria-label={`Test ${i + 1} output`} rows={2} className="mono" placeholder="expected stdout" value={tc.output} onChange={(e) => setAnswer({ ...a, tests: a.tests.map((x, j) => (j === i ? { ...x, output: e.target.value } : x)) })} style={{ flex: 1, minWidth: 160 }} />
                    <label className="row" style={{ gap: 4, fontWeight: 500 }}>
                      <input type="checkbox" style={{ width: "auto" }} checked={tc.hidden} onChange={(e) => setAnswer({ ...a, tests: a.tests.map((x, j) => (j === i ? { ...x, hidden: e.target.checked } : x)) })} /> Hidden
                    </label>
                    <button className="btn ghost small" disabled={a.tests.length <= 2} onClick={() => setAnswer({ ...a, tests: a.tests.filter((_, j) => j !== i) })}>
                      Remove
                    </button>
                  </div>
                ))}
                <button className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => setAnswer({ ...a, tests: [...a.tests, { input: "", output: "", hidden: true }] })}>
                  Add test
                </button>
                {(input.body.languages ?? []).map((l) => (
                  <div key={l} className="stack" style={{ gap: 6 }}>
                    <label>{LANG_LABEL[l]} starter code (optional)</label>
                    <CodeEditor key={`starter-${l}-${loadKey}`} language={l} value={input.body.starterCode?.[l] ?? ""} onChange={(v) => setBody({ starterCode: { ...input.body.starterCode, [l]: v } })} minHeight={80} label={`${LANG_LABEL[l]} starter code`} />
                    <label>{LANG_LABEL[l]} reference solution (never shown to students)</label>
                    <CodeEditor key={`sol-${l}-${loadKey}`} language={l} value={input.solutions?.[l] ?? ""} onChange={(v) => set({ solutions: { ...input.solutions, [l]: v } })} minHeight={140} label={`${LANG_LABEL[l]} reference solution`} />
                  </div>
                ))}
              </div>
            )}

            {a.kind === "sql" && (
              <div className="stack">
                <label>Tables and rows (CREATE TABLE and INSERT statements)</label>
                <CodeEditor key={`schema-${loadKey}`} language="sql" value={input.body.schema ?? ""} onChange={(schema) => setBody({ schema })} minHeight={140} label="SQL schema" />
                <label>Model query</label>
                <CodeEditor key={`solution-${loadKey}`} language="sql" value={a.solution} onChange={(solution) => setAnswer({ ...a, solution })} minHeight={80} label="Model query" />
                <label className="row" style={{ gap: 6, fontWeight: 500 }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={Boolean(a.ordered)} onChange={(e) => setAnswer({ ...a, ordered: e.target.checked })} /> Row order matters (the question asks for ORDER BY)
                </label>
              </div>
            )}
          </div>

          <div className="card stack">
            <div>
              <label htmlFor="q-exp">Explanation (shown after answering)</label>
              <textarea id="q-exp" rows={3} value={input.explanation} onChange={(e) => set({ explanation: e.target.value })} />
            </div>
            <div>
              <label htmlFor="q-hints">Hints, one per line (vaguest first)</label>
              <textarea id="q-hints" rows={3} value={input.hints.join("\n")} onChange={(e) => set({ hints: e.target.value.split("\n") })} />
            </div>
            <div>
              <label htmlFor="q-tags">Tags</label>
              <input id="q-tags" value={input.tags.join(", ")} onChange={(e) => set({ tags: e.target.value.split(",").map((t) => t.trim()) })} placeholder="e.g. tcs-nqt, off-by-one" />
            </div>
            {runnable && (
              <div>
                <label>How to check it</label>
                <label className="row" style={{ gap: 6, fontWeight: 500 }}>
                  <input type="radio" name="checkMode" style={{ width: "auto" }} checked={input.checkMode === "run"} onChange={() => set({ checkMode: "run" })} /> Run the code and compare its output with the answer
                </label>
                <label className="row" style={{ gap: 6, fontWeight: 500 }}>
                  <input type="radio" name="checkMode" style={{ width: "auto" }} checked={input.checkMode === "manual"} onChange={() => set({ checkMode: "manual" })} /> I have reviewed it myself (fragments, pseudocode, bug spotting)
                </label>
              </div>
            )}
          </div>

          {check && <CheckResult check={check} />}
          {error && <ErrorBox message={error} />}
          {msg && <span className="pill good" style={{ alignSelf: "flex-start" }}>{msg}</span>}
          <div className="row wrap">
            <button className="btn" disabled={busy} onClick={runCheck}>
              {busy ? "Working..." : "Check"}
            </button>
            <button className="btn" disabled={busy} onClick={() => save(false)}>
              {saved?.status === "live" ? "Save changes" : "Save draft"}
            </button>
            {saved?.status !== "live" && (
              <button className="btn primary" disabled={busy} onClick={() => save(true)}>
                Save and publish
              </button>
            )}
            {saved?.status === "live" && (
              <button className="btn ghost" onClick={retire}>
                Retire
              </button>
            )}
          </div>
        </div>
        <div className="studio-preview">
          <Preview key={`${loadKey}-${input.type}-${responseKindFor(input.answer)}`} input={input} />
        </div>
      </div>
    </div>
  );
}

export default function StudioEditor() {
  return (
    <Suspense fallback={<Loading />}>
      <Editor />
    </Suspense>
  );
}
