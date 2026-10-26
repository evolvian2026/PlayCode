"use client";

import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { useEffect, useRef } from "react";

export type EditorLanguage = "python" | "c" | "java" | "sql";

const LANGS: Record<EditorLanguage, () => ReturnType<typeof python>> = {
  python: () => python(),
  c: () => cpp(),
  java: () => java(),
  sql: () => sql(),
};

/** CodeMirror 6 editor. Uncontrolled after mount: `value` seeds it, `onChange` reports edits. */
export function CodeEditor({
  language,
  value,
  onChange,
  readOnly = false,
  label = "Code editor",
  minHeight = 220,
  wrap = false,
}: {
  language: EditorLanguage;
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  label?: string;
  minHeight?: number;
  /** Wrap long lines (useful for SQL on phones). */
  wrap?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const lang = useRef(new Compartment());
  const ro = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          oneDark,
          lang.current.of(LANGS[language]()),
          ro.current.of(EditorState.readOnly.of(readOnly)),
          // An explicit tabindex keeps read-only editors focusable, so keyboard users can scroll long code.
          EditorView.contentAttributes.of({ "aria-label": label, tabindex: "0" }),
          ...(wrap ? [EditorView.lineWrapping] : []),
          EditorView.theme({ "&": { minHeight: `${minHeight}px`, fontSize: "0.88rem" }, ".cm-scroller": { fontFamily: "var(--mono)" } }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // The editor is created once; language, value and readOnly sync below.
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: lang.current.reconfigure(LANGS[language]()) });
  }, [language]);

  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);

  // Replace the text only when it changed from outside (e.g. switching language).
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} className="code-editor" />;
}
