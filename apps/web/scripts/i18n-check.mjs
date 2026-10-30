// Checks the translations: every entry keeps the {placeholders} of its
// English key (a missing {name} shows as nothing, a stray one as "{name}"),
// and no entry is empty. Prints how much of the Hindi set Tamil covers.
import { HI } from "../lib/i18n-hi.ts";
import { TA } from "../lib/i18n-ta.ts";

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
const extra = Object.keys(TA).filter((k) => !(k in HI));
console.log(`Hindi ${Object.keys(HI).length} entries; Tamil ${Object.keys(TA).length} (${extra.length} not in Hindi).`);
if (problems) {
  console.log(`${problems} problems`);
  process.exit(1);
}
console.log("Translations OK");
