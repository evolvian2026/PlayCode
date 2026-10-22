import { QUESTIONS } from "./questions";
import { verifyQuestions } from "./verify";

const results = await verifyQuestions(QUESTIONS);
let failed = 0;
for (const r of results) {
  if (!r.ok) {
    failed++;
    console.log(`FAIL ${r.id}: ${r.problem}`);
  } else if (r.skipped) {
    console.log(`skip ${r.id}: ${r.skipped}`);
  } else {
    console.log(`ok   ${r.id}`);
  }
}
const verified = results.filter((r) => r.ok && !r.skipped).length;
console.log(`\n${verified} verified by execution, ${results.length - verified - failed} checked structurally, ${failed} failed`);
process.exit(failed ? 1 : 0);
