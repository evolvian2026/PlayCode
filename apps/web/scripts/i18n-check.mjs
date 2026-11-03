// Checks the translations: every entry keeps the {placeholders} of its
// English key (a missing {name} shows as nothing, a stray one as "{name}"),
// no entry is empty, and Tamil has everything Hindi has, so a screen
// translated into one language isn't left half in English in the other.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { HI } from "../../../packages/core/src/i18n/hi.ts";
import { TA } from "../../../packages/core/src/i18n/ta.ts";
// Drive eligibility reasons come from the core package in English and are translated by template.
import { ELIGIBILITY_REASON_TEMPLATES } from "../../../packages/core/src/placements.ts";

const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
let problems = 0;
for (const [name, dict] of [["Hindi", HI], ["Tamil", TA]]) {
  for (const [en, tr] of Object.entries(dict)) {
    if (!tr.trim()) {
      console.log(`${name}: empty translation for "${en}"`);
      problems++;
    } else if (vars(en) !== vars(tr)) {
      console.log(`${name}: "${en}" has {${vars(en)}} but the translation has {${vars(tr)}}`);
      problems++;
    }
  }
}
for (const [missing, from, to] of [
  [Object.keys(HI).filter((k) => !(k in TA)), "Hindi", "Tamil"],
  [Object.keys(TA).filter((k) => !(k in HI)), "Tamil", "Hindi"],
]) {
  for (const k of missing) console.log(`${to}: no translation for "${k}" (${from} has one)`);
  problems += missing.length;
}
// Notifications: every msg("...") template in the API must be translated
// (labels passed in as values are checked by a core test). A template built
// with backticks can't be checked, so it isn't allowed.
const apiSrc = new URL("../../api/src", import.meta.url).pathname;
const tsFiles = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? tsFiles(join(dir, f)) : f.endsWith(".ts") ? [join(dir, f)] : []));
const templates = new Set();
for (const file of tsFiles(apiSrc)) {
  const src = readFileSync(file, "utf8");
  for (let i = src.indexOf("msg("); i !== -1; i = src.indexOf("msg(", i + 4)) {
    if (/[\w$.]/.test(src[i - 1] ?? "")) continue;
    // The first argument: up to the top-level comma or closing parenthesis.
    let depth = 0;
    let quote = null;
    let j = i + 4;
    for (; j < src.length; j++) {
      const ch = src[j];
      if (quote) {
        if (ch === "\\") j++;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) {
        if (depth === 0) break;
        depth--;
      } else if (ch === "," && depth === 0) break;
    }
    const arg = src.slice(i + 4, j);
    if (arg.includes("`")) {
      console.log(`${file.slice(apiSrc.length + 1)}: msg() with a template literal can't be translated: msg(${arg.slice(0, 60)}`);
      problems++;
    }
    for (const m of arg.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      // A string compared in a condition (kind === "hr") isn't a template, and "{items}" has nothing to translate.
      if (/[!=]==\s*$/.test(arg.slice(0, m.index))) continue;
      const text = JSON.parse(`"${m[1]}"`);
      if (!/^(\{\w+\}\s*)+$/.test(text)) templates.add(text);
    }
  }
}
for (const [name, dict] of [["Hindi", HI], ["Tamil", TA]])
  for (const k of [...templates].filter((t) => !(t in dict))) {
    console.log(`${name}: no translation for the notification "${k}"`);
    problems++;
  }

for (const [name, dict] of [["Hindi", HI], ["Tamil", TA]])
  for (const k of ELIGIBILITY_REASON_TEMPLATES.filter((r) => !(r in dict))) {
    console.log(`${name}: no translation for the eligibility reason "${k}"`);
    problems++;
  }
// Student screens: every page under app/play and every component they use
// (directly or through other components) must pass its text through t(), and
// every t("...") there must have Hindi and Tamil. Text that stays English on
// purpose (an acronym such as XP or CGPA, a sample in English) is either all
// capitals or marked with an "i18n-ignore" comment on its line or the line before.
const web = new URL("..", import.meta.url).pathname;
const tsxFiles = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? tsxFiles(join(dir, f)) : f.endsWith(".tsx") ? [join(dir, f)] : []));
const studentFiles = new Set(tsxFiles(join(web, "app/play")));
for (let grew = true; grew; ) {
  grew = false;
  for (const file of [...studentFiles]) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/from "(?:@\/components\/|\.\/)(\w+)"/g)) {
      const dep = join(web, "components", `${m[1]}.tsx`);
      if (!studentFiles.has(dep) && (m[0].includes("@/") || file.startsWith(join(web, "components"))) && statSync(dep, { throwIfNoEntry: false })) {
        studentFiles.add(dep);
        grew = true;
      }
    }
  }
}
const TEXT_ATTRS = new Set(["aria-label", "placeholder", "title", "alt", "label"]);
const T_CALLS = new Set(["t", "tr"]);
const hasWords = (s) => /[A-Za-z]{2}/.test(s) && !/^[^a-z]*$/.test(s);
const screenKeys = new Set();
let untranslated = 0;
for (const file of [...studentFiles].sort()) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const at = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
  const ignored = (n) => /i18n-ignore/.test(lines[at(n)] ?? "") || /i18n-ignore/.test(lines[at(n) - 1] ?? "");
  const report = (n, text, what = "not translated") => {
    if (ignored(n)) return;
    console.log(`${file.slice(web.length)}:${at(n) + 1}: ${what}: ${JSON.stringify(text.slice(0, 70))}`);
    untranslated++;
  };
  const visit = (n) => {
    // A component only staff see, in a file students also use, is marked "i18n: staff only" and skipped.
    if (ts.isFunctionDeclaration(n) && /i18n: staff only/.test(src.slice(n.getFullStart(), n.getStart(sf)))) return;
    if (ts.isCallExpression(n) && T_CALLS.has(n.expression.getText(sf)) && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) screenKeys.add(n.arguments[0].text);
    // Dates in the student's language: useDates() or toLocale...String(intlLocale(locale), ...), not the
    // console's English helpers or the browser's default. "en-CA" gives a YYYY-MM-DD key, not text.
    if (ts.isCallExpression(n) && !file.endsWith("components/ui.tsx")) {
      const callee = n.expression.getText(sf);
      const first = n.arguments[0];
      if (callee === "timeAgo" || callee === "formatDate") report(n, `${callee}()`, "English date; use useDates()");
      else if (/\.toLocale(Date|Time)?String$/.test(callee) && (!first || first.getText(sf) === "undefined" || (ts.isStringLiteral(first) && first.text !== "en-CA")))
        report(n, `${callee.split(".").pop()}(${first ? first.getText(sf) : ""})`, "date not in the student's language");
    }
    if (ts.isJsxText(n)) {
      const text = n.getText(sf).replace(/\s+/g, " ").trim();
      if (hasWords(text)) report(n, text);
    } else if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer) && TEXT_ATTRS.has(n.name.getText(sf))) {
      if (hasWords(n.initializer.text)) report(n, n.initializer.text);
    } else if (ts.isTemplateExpression(n) && [n.head, ...n.templateSpans.map((x) => x.literal)].some((part) => hasWords(part.text))) {
      // `${n} hearts` as text or in an aria-label: the words need t("{n} hearts", { n }).
      const p = n.parent;
      if (ts.isJsxExpression(p) && (ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent) || (ts.isJsxAttribute(p.parent) && TEXT_ATTRS.has(p.parent.name.getText(sf))))) report(n, n.getText(sf));
    } else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && hasWords(n.text)) {
      // A string literal shown as text: {cond ? "Passed" : "Failed"}, {label ?? "None"}.
      let p = n.parent;
      while (p && (ts.isConditionalExpression(p) || ts.isParenthesizedExpression(p) || ts.isBinaryExpression(p))) {
        if (ts.isConditionalExpression(p) && p.condition === n) p = null;
        else if (ts.isBinaryExpression(p) && ![ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind)) p = null;
        else p = p.parent;
      }
      if (p && ts.isJsxExpression(p) && (ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent) || (ts.isJsxAttribute(p.parent) && TEXT_ATTRS.has(p.parent.name.getText(sf))))) report(n, n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
problems += untranslated;
for (const [name, dict] of [["Hindi", HI], ["Tamil", TA]])
  for (const k of [...screenKeys].filter((k) => !(k in dict) && hasWords(k))) {
    console.log(`${name}: no translation for "${k}" (used on a student screen)`);
    problems++;
  }
console.log(`Student screens: ${studentFiles.size} files, ${screenKeys.size} texts.`);

console.log(`Hindi ${Object.keys(HI).length} entries; Tamil ${Object.keys(TA).length}.`);
if (problems) {
  console.log(`${problems} problems`);
  process.exit(1);
}
console.log("Translations OK");
