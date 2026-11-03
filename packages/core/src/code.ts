// Helpers for code and SQL grading and code-similarity checks. Pure: the
// execution service runs the programs, these functions judge the results.

/** Trailing spaces and trailing blank lines never decide a verdict. */
export function normalizeOutput(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trimEnd();
}

export function outputsMatch(expected: string, actual: string): boolean {
  return normalizeOutput(expected) === normalizeOutput(actual);
}

export type Cell = string | number | null;

/** Compare query results. Unordered results compare as multisets of rows. */
export function resultSetsMatch(expected: Cell[][], actual: Cell[][], ordered = false): boolean {
  if (expected.length !== actual.length) return false;
  const key = (row: Cell[]) => JSON.stringify(row.map((c) => (typeof c === "number" ? Math.round(c * 1e6) / 1e6 : c)));
  const a = expected.map(key);
  const b = actual.map(key);
  if (!ordered) {
    a.sort();
    b.sort();
  }
  return a.every((v, i) => v === b[i]);
}

const KEYWORDS = new Set(
  (
    "if else for while do return break continue switch case default int long float double char void bool boolean " +
    "class public private protected static final new this super import from def lambda in not and or is None True False " +
    "print printf scanf input range len String System out println try catch except finally with as pass elif struct const"
  ).split(" "),
);

/**
 * Tokens for similarity: comments and string contents dropped, identifiers
 * renamed to a placeholder so renaming variables does not hide copying.
 */
export function codeTokens(source: string): string[] {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/#.*$/gm, " ")
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, " STR ");
  const raw = stripped.match(/[A-Za-z_]\w*|\d+(?:\.\d+)?|==|!=|<=|>=|&&|\|\||\+\+|--|[^\s\w]/g) ?? [];
  return raw.map((t) => (/^[A-Za-z_]/.test(t) && !KEYWORDS.has(t) && t !== "STR" ? "ID" : /^\d/.test(t) ? "NUM" : t));
}

/** Jaccard similarity of token 5-grams, 0-1. Short programs are not compared. */
export function codeSimilarity(a: string, b: string, k = 5): number {
  const grams = (tokens: string[]) => {
    const out = new Set<string>();
    for (let i = 0; i + k <= tokens.length; i++) out.add(tokens.slice(i, i + k).join(" "));
    return out;
  };
  const ta = codeTokens(a);
  const tb = codeTokens(b);
  if (ta.length < 15 || tb.length < 15) return 0;
  const ga = grams(ta);
  const gb = grams(tb);
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  const union = ga.size + gb.size - inter;
  return union === 0 ? 0 : inter / union;
}
