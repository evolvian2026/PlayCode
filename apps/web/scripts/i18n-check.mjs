// Checks the translations: every entry keeps the {placeholders} of its
// English key (a missing {name} shows as nothing, a stray one as "{name}"),
// no entry is empty, and Tamil has everything Hindi has, so a screen
// translated into one language isn't left half in English in the other.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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
console.log(`Hindi ${Object.keys(HI).length} entries; Tamil ${Object.keys(TA).length}.`);
if (problems) {
  console.log(`${problems} problems`);
  process.exit(1);
}
console.log("Translations OK");
