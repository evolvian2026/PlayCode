// Checks the translations: every entry keeps the {placeholders} of its
// English key (a missing {name} shows as nothing, a stray one as "{name}"),
// no entry is empty, and Tamil has everything Hindi has, so a screen
// translated into one language isn't left half in English in the other.
import { HI } from "../lib/i18n-hi.ts";
import { TA } from "../lib/i18n-ta.ts";
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
