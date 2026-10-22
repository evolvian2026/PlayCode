"use client";

import type { Answer, StudentResponse } from "@playcode/core";
import { CodeBlock } from "./CodeBlock";
import { CodeQuestion, SqlQuestion, type CodeDraft } from "./CodeAnswer";
import type { QuestionView } from "@/lib/types";

/** The in-progress answer, before it becomes a StudentResponse. */
export type Draft =
  | { kind: "option"; optionId: string | null }
  | { kind: "text"; value: string }
  | { kind: "lines"; lines: number[] }
  | { kind: "order"; ids: string[] }
  | CodeDraft
  | { kind: "sql"; query: string };

export function emptyDraft(q: QuestionView): Draft {
  switch (q.responseKind) {
    case "option":
      return { kind: "option", optionId: null };
    case "text":
      return { kind: "text", value: "" };
    case "lines":
      return { kind: "lines", lines: [] };
    case "order":
      return { kind: "order", ids: [] };
    case "code":
      return { kind: "code", language: q.body.languages?.[0] ?? "python", sources: { ...q.body.starterCode } };
    case "sql":
      return { kind: "sql", query: "SELECT " };
  }
}

export function draftToResponse(d: Draft): StudentResponse | null {
  switch (d.kind) {
    case "option":
      return d.optionId ? { kind: "option", optionId: d.optionId } : null;
    case "text":
      return d.value.trim() ? { kind: "text", value: d.value } : null;
    case "lines":
      return d.lines.length ? { kind: "lines", lines: d.lines } : null;
    case "order":
      return d.ids.length ? { kind: "order", ids: d.ids } : null;
    case "code": {
      const source = d.sources[d.language] ?? "";
      return source.trim() ? { kind: "code", language: d.language, source } : null;
    }
    case "sql":
      return d.query.trim() && d.query.trim().toUpperCase() !== "SELECT" ? { kind: "sql", query: d.query } : null;
  }
}

interface Props {
  question: QuestionView;
  draft: Draft;
  onChange: (d: Draft) => void;
  onSubmit: () => void;
  /** Set once answered: the correct answer, for marking right and wrong choices. */
  answer: Answer | null;
}

export function QuestionInput({ question, draft, onChange, onSubmit, answer }: Props) {
  const { body } = question;
  const locked = answer !== null;

  if (draft.kind === "code") return <CodeQuestion question={question} draft={draft} onChange={onChange} locked={locked} />;
  if (draft.kind === "sql") return <SqlQuestion question={question} query={draft.query} onChange={(query) => onChange({ kind: "sql", query })} locked={locked} />;

  if (draft.kind === "lines") {
    const right = answer?.kind === "lines" ? new Set(answer.lines) : null;
    return (
      <div className="stack">
        <CodeBlock
          code={body.code ?? ""}
          label="Code: tap the line with the bug"
          onLineClick={
            locked
              ? undefined
              : (n) => onChange({ kind: "lines", lines: draft.lines.includes(n) ? draft.lines.filter((x) => x !== n) : [...draft.lines, n] })
          }
          lineClass={(n) => {
            if (right) {
              if (right.has(n)) return "right";
              if (draft.lines.includes(n)) return "wrong";
              return "";
            }
            return draft.lines.includes(n) ? "picked" : "";
          }}
        />
        {!locked && <p className="muted small">Tap a line to select it. Tap again to unselect.</p>}
      </div>
    );
  }

  const codeBlock = body.code ? <CodeBlock code={body.code} /> : null;
  const examples = body.examples?.length ? (
    <div className="card tight">
      <table>
        <thead>
          <tr>
            <th>Call</th>
            <th>Returns</th>
          </tr>
        </thead>
        <tbody>
          {body.examples.map((e) => (
            <tr key={e.input}>
              <td style={{ fontFamily: "var(--mono)" }}>{e.input}</td>
              <td style={{ fontFamily: "var(--mono)" }}>{e.output}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : null;

  if (draft.kind === "option") {
    const correctId = answer?.kind === "option" ? answer.optionId : null;
    return (
      <div className="stack">
        {codeBlock}
        {examples}
        <div className="stack" role="radiogroup" aria-label="Answer options" style={{ gap: 8 }}>
          {body.options?.map((o) => {
            let cls = "option";
            if (correctId) {
              if (o.id === correctId) cls += " right";
              else if (o.id === draft.optionId) cls += " wrong";
            } else if (o.id === draft.optionId) cls += " picked";
            return (
              <button
                key={o.id}
                className={cls}
                role="radio"
                aria-checked={o.id === draft.optionId}
                disabled={locked}
                onClick={() => onChange({ kind: "option", optionId: o.id })}
              >
                {o.code ? <pre>{o.text}</pre> : o.text}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (draft.kind === "text") {
    return (
      <div className="stack">
        {codeBlock}
        <input
          aria-label="Your answer"
          placeholder={body.inputHint ?? "Type your answer"}
          value={draft.value}
          disabled={locked}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          style={{ fontFamily: "var(--mono)", fontSize: "1.05rem" }}
          onChange={(e) => onChange({ kind: "text", value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
          }}
        />
      </div>
    );
  }

  // Parsons: tap lines in the pool to build the program; tap a placed line to send it back.
  const lines = body.lines ?? [];
  const byId = new Map(lines.map((l) => [l.id, l]));
  const pool = lines.filter((l) => !draft.ids.includes(l.id));
  return (
    <div className="stack">
      <div>
        <div className="muted small" style={{ marginBottom: 4 }}>
          Your program
        </div>
        <div className="dropzone" aria-label="Your program">
          {draft.ids.length === 0 && <span className="muted small">Tap lines below to place them here, in order.</span>}
          {draft.ids.map((id, i) => (
            <button
              key={id}
              className="option parsons-line"
              disabled={locked}
              onClick={() => onChange({ kind: "order", ids: draft.ids.filter((x) => x !== id) })}
              aria-label={`Line ${i + 1}: ${byId.get(id)?.text.trim()}. Tap to remove.`}
            >
              {byId.get(id)?.text}
            </button>
          ))}
        </div>
      </div>
      {!locked && pool.length > 0 && (
        <div>
          <div className="muted small" style={{ marginBottom: 4 }}>
            Available lines
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {pool.map((l) => (
              <button key={l.id} className="option parsons-line" onClick={() => onChange({ kind: "order", ids: [...draft.ids, l.id] })}>
                {l.text}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
