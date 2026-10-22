"use client";

import { useState } from "react";
import { CODE_LANGUAGE_LABELS, type CodeLanguage } from "@playcode/core";
import { CodeBlock } from "./CodeBlock";
import { CodeEditor } from "./CodeEditor";
import type { Evaluation, QuestionView, SqlResult, TestResult } from "@/lib/types";

const STATUS_LABEL: Record<TestResult["status"], string> = {
  ok: "Ran",
  compile_error: "Compilation error",
  runtime_error: "Runtime error",
  timeout: "Time limit exceeded",
  output_limit: "Too much output",
  internal_error: "Could not run",
};

export function ResultTable({ result }: { result: SqlResult }) {
  if (!result.ok) return <div className="error">{result.error ?? "The query failed"}</div>;
  if (result.rows.length === 0) return <p className="muted small">No rows.</p>;
  return (
    <div className="table-wrap card tight" style={{ padding: 0 }}>
      <table className="result-table">
        <thead>
          <tr>
            {result.columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c === null ? "NULL" : String(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Test-by-test results for code, or the result table for SQL. */
export function EvaluationView({ evaluation, title }: { evaluation: Evaluation; title?: string }) {
  if (evaluation.kind === "sql") {
    return (
      <div className="stack" style={{ gap: 6 }}>
        {title && <div className="small muted">{title}</div>}
        <ResultTable result={evaluation.result} />
      </div>
    );
  }
  const hidden = evaluation.tests.filter((t) => t.hidden);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="spread small">
        <span className="muted">{title ?? "Tests"}</span>
        <b>
          {evaluation.passed}/{evaluation.total} passed
        </b>
      </div>
      {evaluation.compileError && (
        <div className="test-row fail">
          <b>Compilation error</b>
          <pre>{evaluation.compileError}</pre>
        </div>
      )}
      {!evaluation.compileError &&
        evaluation.tests
          .filter((t) => !t.hidden)
          .map((t, i) => (
            <div key={i} className={`test-row ${t.passed ? "pass" : "fail"}`}>
              <div className="spread">
                <b>Sample {i + 1}</b>
                <span>{t.passed ? "Passed" : t.status === "ok" ? "Wrong output" : STATUS_LABEL[t.status]}</span>
              </div>
              {!t.passed && (
                <>
                  <div className="small muted">Input</div>
                  <pre>{t.input || "(empty)"}</pre>
                  <div className="small muted">Expected</div>
                  <pre>{t.expected || "(nothing)"}</pre>
                  <div className="small muted">Your output</div>
                  <pre>{t.actual || "(nothing)"}</pre>
                  {t.stderr && <pre style={{ color: "var(--bad)" }}>{t.stderr}</pre>}
                </>
              )}
            </div>
          ))}
      {hidden.length > 0 && !evaluation.compileError && (
        <div className="test-row">
          Hidden tests: {hidden.filter((t) => t.passed).length}/{hidden.length} passed
          {hidden.some((t) => t.status === "timeout") && " (some hit the time limit)"}
        </div>
      )}
    </div>
  );
}

export interface CodeDraft {
  kind: "code";
  language: CodeLanguage;
  sources: Partial<Record<CodeLanguage, string>>;
  /** The untouched starter code, so it never counts as an answer. */
  starters?: Partial<Record<CodeLanguage, string>>;
}

export function CodeQuestion({ question, draft, onChange, locked }: { question: QuestionView; draft: CodeDraft; onChange: (d: CodeDraft) => void; locked: boolean }) {
  const languages = question.body.languages ?? ["python"];
  return (
    <div className="stack">
      {question.body.sampleTests?.map((t, i) => (
        <div key={i} className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <div className="small muted">Sample input {i + 1}</div>
            <CodeBlock code={t.input || " "} />
          </div>
          <div>
            <div className="small muted">Expected output</div>
            <CodeBlock code={t.output || " "} />
          </div>
        </div>
      ))}
      <div className="spread">
        <label htmlFor="lang" style={{ margin: 0 }}>
          Language
        </label>
        <select
          id="lang"
          value={draft.language}
          disabled={locked}
          style={{ maxWidth: 160 }}
          onChange={(e) => onChange({ ...draft, language: e.target.value as CodeLanguage })}
        >
          {languages.map((l) => (
            <option key={l} value={l}>
              {CODE_LANGUAGE_LABELS[l]}
            </option>
          ))}
        </select>
      </div>
      <CodeEditor
        language={draft.language}
        value={draft.sources[draft.language] ?? question.body.starterCode?.[draft.language] ?? ""}
        readOnly={locked}
        onChange={(v) => onChange({ ...draft, sources: { ...draft.sources, [draft.language]: v } })}
      />
      {draft.language === "java" && <p className="muted small" style={{ margin: 0 }}>Keep the class name Main.</p>}
    </div>
  );
}

export function SqlQuestion({ question, query, onChange, locked }: { question: QuestionView; query: string; onChange: (q: string) => void; locked: boolean }) {
  const [showSchema, setShowSchema] = useState(true);
  return (
    <div className="stack">
      <div>
        <button className="btn ghost small" style={{ paddingLeft: 0 }} onClick={() => setShowSchema(!showSchema)} aria-expanded={showSchema}>
          {showSchema ? "Hide" : "Show"} tables
        </button>
        {showSchema && <CodeBlock code={question.body.schema ?? ""} label="Tables" />}
      </div>
      <CodeEditor language="sql" value={query} readOnly={locked} onChange={onChange} minHeight={120} label="SQL query" wrap />
    </div>
  );
}
