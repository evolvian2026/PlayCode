import { seededRandom } from "./questions";

// Aptitude questions made from templates: numbers are drawn from a seed, the
// answer is computed rather than typed, and the worked solution comes with
// it. So practice never runs out or repeats, every answer is right by
// construction, and a question can be rebuilt from (template, level, seed).
// Levels 1 to 5 make the numbers larger and the steps more numerous.

export type AptitudeTopic = "quant" | "reasoning";

export interface GeneratedQuestion {
  template: string;
  level: number;
  seed: number;
  prompt: string;
  options: string[];
  /** Index of the right option. */
  answer: number;
  explanation: string;
  /** The data a data-interpretation question asks about. */
  table?: DataTable;
}

export interface DataTable {
  caption: string;
  columns: string[];
  rows: string[][];
}

type Rand = () => number;
interface Made {
  prompt: string;
  correct: string;
  /** Plausible wrong answers, from the usual slips; more than three is fine. */
  wrong: string[];
  explanation: string;
  table?: DataTable;
}
interface Template {
  id: string;
  topic: AptitudeTopic;
  label: string;
  make: (r: Rand, level: number) => Made;
}

const int = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
/** Up to two decimals, without trailing zeros. */
const num = (x: number) => String(Math.round(x * 100) / 100);
const rupees = (x: number) => `₹${Math.round(x * 100) / 100}`;
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** A fraction in lowest terms, "3/6" as "1/2". */
const frac = (n: number, d: number) => `${n / gcd(n, d)}/${d / gcd(n, d)}`;
/** A ratio in lowest terms, "4:6" as "2:3". */
const ratio = (a: number, b: number) => `${a / gcd(a, b)}:${b / gcd(a, b)}`;
/** "1x" as "x". */
const times = (c: number, v: string) => (c === 1 ? v : `${c}${v}`);
const hours = (x: number) => `${num(x)} ${x === 1 ? "hour" : "hours"}`;
const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
const choose = (n: number, k: number) => Math.round(fact(n) / (fact(k) * fact(n - k)));
function shuffled<T>(r: Rand, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// Blood relations: how P stands to Q, as P's gender, how many generations P
// is above Q, and whether P is in Q's direct line or a sibling of it.
interface Rel {
  g: "m" | "f";
  d: number;
  side: "line" | "sibling";
}
const LINKS: (Rel & { word: string })[] = [
  { word: "mother", g: "f", d: 1, side: "line" },
  { word: "father", g: "m", d: 1, side: "line" },
  { word: "brother", g: "m", d: 0, side: "sibling" },
  { word: "sister", g: "f", d: 0, side: "sibling" },
];
const REL_NAMES: Record<string, string> = { m0sibling: "Brother", f0sibling: "Sister", m1line: "Father", f1line: "Mother", m2line: "Grandfather", f2line: "Grandmother", m1sibling: "Uncle", f1sibling: "Aunt" };
const RELATIONS = {
  male: ["Father", "Grandfather", "Brother", "Uncle", "Son", "Nephew", "Son-in-law", "Brother-in-law"],
  female: ["Mother", "Grandmother", "Sister", "Aunt", "Daughter", "Niece", "Mother-in-law", "Sister-in-law"],
};
/** P's relation to R from P's to Q and Q's to R; null when it has no everyday name here. */
function compose(a: Rel, b: Rel): Rel | null {
  if (a.side === "line") return { g: a.g, d: a.d + b.d, side: "line" }; // a parent of Q's relative in R's line
  if (a.d === 0) return { g: a.g, d: b.d, side: "sibling" }; // Q's sibling stands to R as a sibling of Q's place
  return null;
}
/** The relation along a chain of links, or null if some step has no name. */
function relOf(links: Rel[]): Rel | null {
  let rel: Rel | null = links[0]!;
  for (const l of links.slice(1)) rel = rel && compose(rel, l);
  return rel && REL_NAMES[`${rel.g}${rel.d}${rel.side}`] ? rel : null;
}
const relName = (rel: Rel) => REL_NAMES[`${rel.g}${rel.d}${rel.side}`]!;

// Syllogisms are checked by brute force: every way k groups can overlap (each
// region of the Venn diagram empty or not, every group non-empty), keeping
// the ways that fit the statements. A conclusion follows if it is true in all.
interface Claim {
  kind: "all" | "no" | "some" | "some-not";
  a: number;
  b: number;
}
const claim = (c: Claim, w: string[]) => ({ all: `All ${w[c.a]} are ${w[c.b]}.`, no: `No ${w[c.a]} are ${w[c.b]}.`, some: `Some ${w[c.a]} are ${w[c.b]}.`, "some-not": `Some ${w[c.a]} are not ${w[c.b]}.` })[c.kind];
/** Regions (as a bit mask over the diagram's 2^k − 1 regions) where the claim's two groups meet as it says. */
function claimMask(k: number, c: Claim) {
  let mask = 0;
  for (let reg = 1; reg < 1 << k; reg++) {
    const inA = (reg >> c.a) & 1;
    const inB = (reg >> c.b) & 1;
    if (inA && (c.kind === "all" || c.kind === "some-not" ? !inB : inB)) mask |= 1 << (reg - 1);
  }
  return mask;
}
/** "All" and "no" need the regions empty; "some" and "some … not" need one of them filled. */
const holds = (k: number, m: number, c: Claim) => ((m & claimMask(k, c)) === 0) === (c.kind === "all" || c.kind === "no");
function venn(k: number, premises: Claim[]): number[] {
  const groups = Array.from({ length: k }, (_, t) => {
    let mask = 0;
    for (let reg = 1; reg < 1 << k; reg++) if ((reg >> t) & 1) mask |= 1 << (reg - 1);
    return mask;
  });
  const masks = premises.map((p) => ({ mask: claimMask(k, p), empty: p.kind === "all" || p.kind === "no" }));
  const out: number[] = [];
  for (let m = 0; m < 1 << ((1 << k) - 1); m++)
    if (groups.every((g) => m & g) && masks.every((p) => ((m & p.mask) === 0) === p.empty)) out.push(m);
  return out;
}
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const TEMPLATES: Template[] = [
  {
    id: "percentages",
    topic: "quant",
    label: "Percentages",
    make(r, level) {
      if (level <= 2) {
        const p = pick(r, level === 1 ? [10, 20, 25, 50] : [12, 15, 35, 45, 60, 75]);
        const n = int(r, 2, level === 1 ? 20 : 60) * 20;
        const v = (p / 100) * n;
        return { prompt: `What is ${p}% of ${n}?`, correct: num(v), wrong: [num(v * 10), num(v / 2), num(n - v), num(v + p)], explanation: `${p}% of ${n} = ${p}/100 × ${n} = ${num(v)}.` };
      }
      if (level === 5) {
        const p = pick(r, [20, 25, 50, 60, 100]);
        const cut = (p / (100 + p)) * 100;
        return {
          prompt: `The price of rice rises by ${p}%. By what percent must a family cut the amount it buys to spend the same?`,
          correct: `${num(cut)}%`,
          wrong: [`${p}%`, `${num(cut + 5)}%`, `${num(100 - p)}%`, `${num(p / 2)}%`],
          explanation: `Spending = price × amount. If the price becomes ${100 + p}% of before, the amount must become 100/${100 + p} of before, a cut of ${p}/${100 + p} × 100 = ${num(cut)}%.`,
        };
      }
      const a = pick(r, [10, 20, 25, 30, 40, 50]);
      const b = pick(r, level === 3 ? [10, 20] : [15, 20, 25, 30]);
      const net = (1 + a / 100) * (1 - b / 100) * 100 - 100;
      const word = net >= 0 ? "increase" : "decrease";
      const show = (x: number) => `${num(Math.abs(x))}% ${x >= 0 ? "increase" : "decrease"}`;
      return {
        prompt: `A price is raised by ${a}% and then the new price is cut by ${b}%. What is the overall change?`,
        correct: show(net),
        wrong: [show(a - b), show(-net), show(a - b - (a * b) / 100 + 2 * ((a * b) / 100)), show(net + 5)],
        explanation: `Take the price as 100. After +${a}%: ${100 + a}. After −${b}%: ${num(100 + a)} × ${(100 - b) / 100} = ${num(100 + net)}. That is a ${num(Math.abs(net))}% ${word}, not ${a}% − ${b}%: the cut applies to the raised price.`,
      };
    },
  },
  {
    id: "profit-loss",
    topic: "quant",
    label: "Profit and loss",
    make(r, level) {
      if (level <= 2) {
        const cost = int(r, 4, 40) * 25;
        const p = pick(r, level === 1 ? [10, 20, 25, 40] : [12, 15, 30, 35]);
        const loss = level === 2;
        const sp = cost * (1 + (loss ? -p : p) / 100);
        return {
          prompt: `An article costs ${rupees(cost)} and is sold at a ${loss ? "loss" : "profit"} of ${p}%. What is the selling price?`,
          correct: rupees(sp),
          wrong: [rupees(cost * (1 + (loss ? p : -p) / 100)), rupees(cost + (loss ? -p : p)), rupees(sp + cost / 10)],
          explanation: `Selling price = cost × (100 ${loss ? "−" : "+"} ${p})/100 = ${cost} × ${loss ? 100 - p : 100 + p}/100 = ${rupees(sp)}.`,
        };
      }
      if (level === 3) {
        const cost = int(r, 4, 30) * 40;
        const sp = cost * pick(r, [1.15, 1.25, 0.8, 0.9, 1.2]);
        const pct = ((sp - cost) / cost) * 100;
        const show = (x: number) => `${num(Math.abs(x))}% ${x >= 0 ? "profit" : "loss"}`;
        return { prompt: `A shopkeeper buys an article for ${rupees(cost)} and sells it for ${rupees(sp)}. What is the profit or loss percent?`, correct: show(pct), wrong: [show(-pct), show(((sp - cost) / sp) * 100), show(pct * 2)], explanation: `The ${pct >= 0 ? "profit" : "loss"} is ${rupees(Math.abs(sp - cost))}, and the percent is always on the cost: ${num(Math.abs(sp - cost))}/${cost} × 100 = ${num(Math.abs(pct))}% ${pct >= 0 ? "profit" : "loss"}.` };
      }
      // Marked price, discount, and the profit that remains: find the cost.
      const p = pick(r, [10, 20, 25, 35]);
      const d = pick(r, level === 4 ? [10, 20] : [12.5, 25, 37.5, 40]);
      // A cost that makes the marked price a whole number of rupees.
      let cost = int(r, 5, 40) * 100;
      while (!Number.isInteger(Math.round(((cost * (1 + p / 100)) / (1 - d / 100)) * 1e6) / 1e6)) cost += 100;
      const sp = cost * (1 + p / 100);
      const marked = sp / (1 - d / 100);
      return {
        prompt: `An article marked at ${rupees(marked)} is sold at a ${d}% discount, and the seller still makes a ${p}% profit. What did it cost?`,
        correct: rupees(cost),
        wrong: [rupees(marked * (1 - d / 100) * (1 - p / 100)), rupees(marked * (1 - (d + p) / 100)), rupees(sp), rupees(cost * 1.1)],
        explanation: `Selling price = ${num(marked)} × (100 − ${d})/100 = ${num(sp)}. That is ${100 + p}% of the cost, so cost = ${num(sp)} × 100/${100 + p} = ${rupees(cost)}.`,
      };
    },
  },
  {
    id: "interest",
    topic: "quant",
    label: "Simple and compound interest",
    make(r, level) {
      const P = int(r, 2, 20) * (level >= 4 ? 1000 : 500);
      const rate = pick(r, [5, 8, 10, 12, 15, 20]);
      if (level <= 2) {
        const t = int(r, 2, 5);
        const si = (P * rate * t) / 100;
        if (level === 2)
          return { prompt: `${rupees(P)} is lent at ${rate}% a year simple interest. What does it amount to after ${t} years?`, correct: rupees(P + si), wrong: [rupees(si), rupees(P + (P * rate) / 100), rupees(P * (1 + rate / 100) ** t)], explanation: `Interest = ${P} × ${rate} × ${t} / 100 = ${num(si)}. Amount = ${P} + ${num(si)} = ${rupees(P + si)}.` };
        return { prompt: `What is the simple interest on ${rupees(P)} at ${rate}% a year for ${t} years?`, correct: rupees(si), wrong: [rupees(P + si), rupees((P * rate) / 100), rupees(si * 1.1)], explanation: `Simple interest = P × R × T / 100 = ${P} × ${rate} × ${t} / 100 = ${rupees(si)}.` };
      }
      if (level === 3) {
        const t = int(r, 2, 6);
        const si = (P * rate * t) / 100;
        return { prompt: `A sum of ${rupees(P)} earns ${rupees(si)} in simple interest in ${t} years. What is the rate a year?`, correct: `${rate}%`, wrong: [`${num(rate * t)}%`, `${num(rate / 2)}%`, `${num(rate + 2)}%`, `${num((si / P) * 100)}%`].filter((w) => w !== `${rate}%`), explanation: `R = SI × 100 / (P × T) = ${num(si)} × 100 / (${P} × ${t}) = ${rate}%.` };
      }
      if (level === 4) {
        const ci = P * (1 + rate / 100) ** 2 - P;
        return { prompt: `What is the compound interest on ${rupees(P)} at ${rate}% a year for 2 years, compounded yearly?`, correct: rupees(ci), wrong: [rupees((P * rate * 2) / 100), rupees(P + ci), rupees(ci + (P * rate) / 100)], explanation: `Amount = ${P} × (1 + ${rate}/100)² = ${num(P + ci)}. Interest = ${num(P + ci)} − ${P} = ${rupees(ci)}.` };
      }
      const diff = P * (rate / 100) ** 2;
      return { prompt: `On ${rupees(P)} for 2 years at ${rate}% a year, how much more is compound interest than simple interest?`, correct: rupees(diff), wrong: [rupees(diff * 2), rupees((P * rate) / 100), rupees(diff / 2)], explanation: `For 2 years the difference is P × (R/100)²: the second year's interest on the first year's interest. ${P} × (${rate}/100)² = ${rupees(diff)}.` };
    },
  },
  {
    id: "time-work",
    topic: "quant",
    label: "Time and work",
    make(r, level) {
      // Pairs whose combined time is a whole number of days.
      const pairs: [number, number, number][] = [
        [6, 12, 4],
        [10, 15, 6],
        [12, 24, 8],
        [20, 30, 12],
        [18, 36, 12],
        [24, 40, 15],
        [30, 60, 20],
        [12, 36, 9],
        [14, 35, 10],
        [21, 42, 14],
      ];
      const [a, b, both] = pick(r, level === 1 ? pairs.slice(0, 3) : level === 2 ? pairs.slice(0, 6) : pairs);
      if (level <= 3) {
        return { prompt: `A can finish a job in ${a} days and B in ${b} days. Working together, how many days will they take?`, correct: `${both} days`, wrong: [`${(a + b) / 2} days`, `${b - a} days`, `${both + 2} days`, `${a + b} days`], explanation: `In a day A does 1/${a} of the job and B 1/${b}. Together 1/${a} + 1/${b} = 1/${both} a day, so ${both} days.` };
      }
      // A works some days alone, then B finishes.
      const first = int(r, 1, a - 1);
      const left = 1 - first / a;
      const bDays = left * b;
      return {
        prompt: `A can finish a job in ${a} days and B in ${b} days. A works alone for ${first} day${first > 1 ? "s" : ""} and then B finishes the rest. How many days does B work?`,
        correct: `${num(bDays)} days`,
        wrong: [`${b - first} days`, `${num(left * a)} days`, `${num(bDays + 1)} days`, `${num((1 - first / b) * b)} days`].filter((w) => w !== `${num(bDays)} days`),
        explanation: `In ${first} day${first > 1 ? "s" : ""} A does ${frac(first, a)} of the job, leaving ${frac(a - first, a)}. B does 1/${b} a day, so B needs ${frac(a - first, a)} × ${b} = ${num(bDays)} days.`,
      };
    },
  },
  {
    id: "trains",
    topic: "quant",
    label: "Speed, time and distance",
    make(r, level) {
      // Speeds in multiples of 18 km/h, so they are whole metres a second.
      const v = pick(r, [36, 54, 72, 90, 108]);
      const ms = (v * 5) / 18;
      const len = ms * int(r, 6, 15);
      if (level === 2) {
        const t = len / ms;
        return { prompt: `A train running at ${v} km/h passes a pole in ${num(t)} seconds. How long is the train?`, correct: `${num(len)} m`, wrong: [`${num(v * t)} m`, `${num(len / 2)} m`, `${num(len + ms * 2)} m`], explanation: `${v} km/h = ${v} × 5/18 = ${ms} m/s. In ${num(t)} seconds it covers its own length: ${ms} × ${num(t)} = ${num(len)} m.` };
      }
      if (level === 1) {
        const t = len / ms;
        return { prompt: `A train ${len} m long runs at ${v} km/h. How long does it take to pass a pole?`, correct: `${num(t)} seconds`, wrong: [`${num(len / v)} seconds`, `${num(t * 2)} seconds`, `${num(t + 3)} seconds`], explanation: `${v} km/h = ${v} × 5/18 = ${ms} m/s. It covers its own length: ${len}/${ms} = ${num(t)} seconds.` };
      }
      if (level === 3) {
        const plat = ms * int(r, 5, 20);
        const t = (len + plat) / ms;
        return { prompt: `A train ${len} m long at ${v} km/h crosses a platform ${plat} m long. How many seconds does it take?`, correct: `${num(t)} seconds`, wrong: [`${num(len / ms)} seconds`, `${num(plat / ms)} seconds`, `${num(t + 4)} seconds`], explanation: `It must cover its length plus the platform: ${len} + ${plat} = ${len + plat} m at ${ms} m/s (${v} × 5/18), so ${num(t)} seconds.` };
      }
      const v2 = pick(r, [36, 54, 72].filter((x) => x !== v));
      const ms2 = (v2 * 5) / 18;
      const len2 = ms2 * int(r, 5, 12);
      const opposite = level === 5 ? r() < 0.5 : true;
      const rel = opposite ? ms + ms2 : Math.abs(ms - ms2);
      const t = (len + len2) / rel;
      return {
        prompt: `Two trains ${len} m and ${len2} m long run on parallel tracks at ${v} km/h and ${v2} km/h, ${opposite ? "towards each other" : "in the same direction"}. How long do they take to pass each other completely?`,
        correct: `${num(t)} seconds`,
        wrong: [`${num((len + len2) / (opposite ? Math.abs(ms - ms2) || 1 : ms + ms2))} seconds`, `${num((len + len2) / ms)} seconds`, `${num(t + 6)} seconds`].filter((w) => w !== `${num(t)} seconds`),
        explanation: `Relative speed ${opposite ? "adds" : "subtracts"}: ${ms} ${opposite ? "+" : "−"} ${ms2} = ${rel} m/s. They cover both lengths, ${len + len2} m, in ${num(t)} seconds.`,
      };
    },
  },
  {
    id: "averages",
    topic: "quant",
    label: "Averages",
    make(r, level) {
      const n = int(r, 4, level <= 2 ? 8 : 15);
      const avg = int(r, 20, 80);
      if (level === 2) {
        const drop = avg - (n - 1) * int(r, 1, 3);
        const next = (avg * n - drop) / (n - 1);
        return { prompt: `The average of ${n} numbers is ${avg}. If the number ${drop} is removed, what is the average of the rest?`, correct: num(next), wrong: [num(avg - drop / n), num((avg + drop) / 2), num(next - 1)], explanation: `Total = ${n} × ${avg} = ${n * avg}. Without ${drop}: ${n * avg - drop} over ${n - 1} numbers = ${num(next)}.` };
      }
      if (level === 1) {
        const add = avg + n + 1 + int(r, 0, 3) * (n + 1);
        const next = (avg * n + add) / (n + 1);
        return { prompt: `The average of ${n} numbers is ${avg}. A number ${add} is added. What is the new average?`, correct: num(next), wrong: [num((avg + add) / 2), num(avg + add / n), num(next + 1)], explanation: `Total = ${n} × ${avg} = ${n * avg}. New total ${n * avg + add} over ${n + 1} numbers: ${num(next)}.` };
      }
      // One value replaced by another changes the average.
      const change = pick(r, [1, 2, 3, 1.5, 2.5]);
      const old = int(r, 30, 60);
      const nw = old + change * n;
      return {
        prompt: `The average weight of ${n} people rises by ${change} kg when one of them, weighing ${old} kg, is replaced by someone new. How much does the new person weigh?`,
        correct: `${num(nw)} kg`,
        wrong: [`${num(old + change)} kg`, `${num(old + change * (n - 1))} kg`, `${num(old - change * n)} kg`],
        explanation: `The total rises by ${n} × ${change} = ${num(change * n)} kg, all from the swap. So the new person weighs ${old} + ${num(change * n)} = ${num(nw)} kg.`,
      };
    },
  },
  {
    id: "ratios",
    topic: "quant",
    label: "Ratio and partnership",
    make(r, level) {
      if (level <= 3) {
        const a = int(r, 1, 7);
        let b = int(r, 1, 7);
        while (b === a) b = int(r, 1, 7);
        let c = level === 3 ? int(r, 1, 5) : 0;
        while (c && (c === a || c === b)) c = int(r, 1, 6);
        const parts = a + b + c;
        const total = parts * int(r, 20, 200) * 10;
        const share = (total * b) / parts;
        const ratio = c ? `${a}:${b}:${c}` : `${a}:${b}`;
        if (level === 2)
          return { prompt: `Money is shared between A and B in the ratio ${ratio}. B gets ${rupees(share)}. What was the total?`, correct: rupees(total), wrong: [rupees((share * a) / b), rupees(share * 2), rupees(share + (share * b) / a)], explanation: `B's ${b} parts are ${num(share)}, so one part is ${num(share / b)}. The total is ${parts} parts: ${rupees(total)}.` };
        return { prompt: `${rupees(total)} is divided among ${c ? "A, B and C" : "A and B"} in the ratio ${ratio}. What is B's share?`, correct: rupees(share), wrong: [rupees((total * a) / parts), rupees(total / (c ? 3 : 2)), rupees((total * b) / (parts + 1))], explanation: `There are ${ratio.split(":").join(" + ")} = ${parts} parts, each ${num(total / parts)}. B gets ${b} parts: ${rupees(share)}.` };
      }
      const capA = int(r, 2, 9) * 10000;
      const capB = int(r, 2, 9) * 10000;
      const monthsB = pick(r, [4, 6, 8, 9]);
      const unitsA = capA * 12;
      const unitsB = capB * monthsB;
      // A profit in whole hundreds per 10,000 capital-months, so the shares come out in whole rupees.
      const profit = ((unitsA + unitsB) / 10000) * int(r, 1, 5) * 100;
      const shareB = (profit * unitsB) / (unitsA + unitsB);
      return {
        prompt: `A starts a business with ${rupees(capA)}. B joins after ${12 - monthsB} months with ${rupees(capB)}. Out of a year's profit of ${rupees(profit)}, what is B's share?`,
        correct: rupees(shareB),
        wrong: [rupees((profit * capB) / (capA + capB)), rupees(profit - shareB), rupees(profit / 2)].filter((w) => w !== rupees(shareB)),
        explanation: `Shares follow capital × months: A ${capA} × 12 = ${unitsA}, B ${capB} × ${monthsB} = ${unitsB}. B gets ${unitsB}/${unitsA + unitsB} of ${num(profit)} = ${rupees(shareB)}.`,
      };
    },
  },
  {
    id: "lcm-hcf",
    topic: "quant",
    label: "LCM and HCF",
    make(r, level) {
      const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
      const lcm = (a: number, b: number) => (a * b) / gcd(a, b);
      if (level === 5) {
        const xs = [pick(r, [4, 6, 8]), pick(r, [9, 10, 12]), pick(r, [15, 16, 18])];
        const l = xs.reduce(lcm);
        const k = int(r, 1, Math.min(...xs) - 1);
        return { prompt: `What is the smallest number that leaves a remainder of ${k} when divided by each of ${xs.join(", ")}?`, correct: String(l + k), wrong: [String(l), String(l - k), String(2 * l + k)], explanation: `A number divisible by all of them is a multiple of their LCM, ${l}. Add the remainder: ${l} + ${k} = ${l + k}.` };
      }
      if (level % 2 === 1) {
        const xs = level === 1 ? [pick(r, [4, 6, 8]), pick(r, [10, 12, 15])] : [pick(r, [6, 8, 9]), pick(r, [10, 12, 15]), pick(r, [16, 18, 20, 24])];
        const l = xs.reduce(lcm);
        return { prompt: `Bells ring every ${xs.join(", ").replace(/, ([^,]*)$/, " and $1")} minutes. They ring together at 9:00. After how many minutes do they next ring together?`, correct: `${l} minutes`, wrong: [`${xs.reduce((a, b) => a * b)} minutes`, `${xs.reduce((a, b) => a + b)} minutes`, `${l * 2} minutes`].filter((w) => w !== `${l} minutes`), explanation: `They meet again after the LCM of ${xs.join(", ")}: ${l} minutes.` };
      }
      const g = pick(r, level === 2 ? [10, 12, 15, 20] : [24, 30, 36, 45]);
      const m = int(r, 3, 9);
      let k = int(r, 2, 8);
      while (gcd(m, k) !== 1) k++;
      const [w, h] = [g * m, g * k];
      return { prompt: `A floor ${w} cm by ${h} cm is to be covered with equal square tiles, with no cutting. What is the largest tile side possible?`, correct: `${g} cm`, wrong: [`${g / 2} cm`, `${g * 2} cm`, `${Math.min(w, h)} cm`, `${lcm(w, h)} cm`], explanation: `The side must divide both ${w} and ${h}; the largest such is their HCF, ${g} cm.` };
    },
  },
  {
    id: "number-series",
    topic: "reasoning",
    label: "Number series",
    make(r, level) {
      let seq: number[];
      let rule: string;
      if (level === 1) {
        const a = int(r, 2, 20);
        const d = int(r, 3, 9);
        seq = Array.from({ length: 6 }, (_, i) => a + d * i);
        rule = `each term adds ${d}`;
      } else if (level === 2) {
        const a = int(r, 2, 5);
        const q = int(r, 2, 3);
        seq = Array.from({ length: 6 }, (_, i) => a * q ** i);
        rule = `each term is multiplied by ${q}`;
      } else if (level === 3) {
        const a = int(r, 2, 10);
        const d = int(r, 1, 4);
        seq = [a];
        for (let i = 1; i < 6; i++) seq.push(seq[i - 1]! + d * i);
        rule = `the differences grow by ${d}: ${d}, ${2 * d}, ${3 * d}, …`;
      } else if (level === 4) {
        const a = int(r, 1, 9);
        const b = int(r, 20, 40);
        const d1 = int(r, 2, 5);
        const d2 = int(r, 2, 4);
        seq = Array.from({ length: 6 }, (_, i) => (i % 2 === 0 ? a + d1 * (i / 2) : b - d2 * ((i - 1) / 2)));
        rule = `two series alternate: ${a}, ${a + d1}, … rising by ${d1}, and ${b}, ${b - d2}, … falling by ${d2}`;
      } else {
        const k = int(r, -3, 4);
        const cube = r() < 0.5;
        seq = Array.from({ length: 6 }, (_, i) => (i + 1) ** (cube ? 3 : 2) + k);
        rule = `the terms are n${cube ? "³" : "²"} ${k >= 0 ? "+" : "−"} ${Math.abs(k)} for n = 1, 2, 3, …`;
      }
      const shown = seq.slice(0, 5);
      const ans = seq[5]!;
      const d = shown[4]! - shown[3]!;
      return { prompt: `What comes next: ${shown.join(", ")}, ?`, correct: String(ans), wrong: [String(shown[4]! + d), String(ans + 1), String(ans - 2), String(ans + d)].filter((w) => w !== String(ans)), explanation: `The pattern: ${rule}. So the next term is ${ans}.` };
    },
  },
  {
    id: "coding-decoding",
    topic: "reasoning",
    label: "Coding and decoding",
    make(r, level) {
      const words = ["CAT", "DOG", "BIRD", "FISH", "LAMP", "BOOK", "CODE", "JAVA", "GATE", "MILK", "PARK", "TREE"];
      const w1 = pick(r, words);
      let w2 = pick(r, words);
      while (w2 === w1) w2 = pick(r, words);
      const k = level === 1 ? 1 : level === 2 ? int(r, 2, 3) : int(r, 2, 5);
      const reverse = level >= 4;
      const shift = (w: string, by: number) => [...w].map((c) => String.fromCharCode(((c.charCodeAt(0) - 65 + by + 26) % 26) + 65)).join("");
      const code = (w: string) => (reverse ? shift([...w].reverse().join(""), k) : shift(w, k));
      const ans = code(w2);
      return {
        prompt: `In a code, ${w1} is written as ${code(w1)}. How is ${w2} written in that code?`,
        correct: ans,
        wrong: [shift(w2, k + 1), reverse ? shift(w2, k) : shift([...w2].reverse().join(""), k), shift(w2, -k), code(w2).slice(1) + code(w2)[0]].filter((w) => w !== ans),
        explanation: reverse ? `The word is reversed and each letter moved ${k} forward: ${w2} → ${[...w2].reverse().join("")} → ${ans}.` : `Each letter moves ${k} place${k > 1 ? "s" : ""} forward in the alphabet: ${w2} → ${ans}.`,
      };
    },
  },
  {
    id: "directions",
    topic: "reasoning",
    label: "Direction sense",
    make(r, level) {
      const [a, b, c] = pick(r, [
        [3, 4, 5],
        [6, 8, 10],
        [5, 12, 13],
        [8, 15, 17],
        [9, 12, 15],
      ] as const);
      if (level <= 2) {
        const turn = level === 1 ? "right" : "left";
        return { prompt: `Ravi walks ${a} km north, then turns ${turn} and walks ${b} km. How far is Ravi from the starting point?`, correct: `${c} km`, wrong: [`${a + b} km`, `${b - a} km`, `${c + 1} km`], explanation: `North ${a} and ${turn === "right" ? "east" : "west"} ${b} are at right angles, so the distance is √(${a}² + ${b}²) = ${c} km.` };
      }
      // Extra legs that cancel partly; the net is still a right triangle.
      const extraN = int(r, 2, 6);
      const extraE = int(r, 2, 6);
      const legs = `walks ${a + extraN} km north, turns right and walks ${b + extraE} km, turns right and walks ${extraN} km, then turns right and walks ${extraE} km`;
      const ask = level === 5 ? "Where does Priya end up, compared with the starting point?" : "How far is Priya from the starting point?";
      const correct = level === 5 ? `${c} km, north-east` : `${c} km`;
      return {
        prompt: `Priya ${legs}. ${ask}`,
        correct,
        wrong: (level === 5 ? [`${c} km, north-west`, `${a + b} km, north-east`, `${c} km, south-east`] : [`${a + b} km`, `${a + extraN + b + extraE} km`, `${c + 2} km`]).filter((w) => w !== correct),
        explanation: `Net north: ${a + extraN} − ${extraN} = ${a} km. Net east: ${b + extraE} − ${extraE} = ${b} km. Distance √(${a}² + ${b}²) = ${c} km${level === 5 ? ", towards the north-east" : ""}.`,
      };
    },
  },
  {
    id: "clocks-calendars",
    topic: "reasoning",
    label: "Clocks and calendars",
    make(r, level) {
      if (level <= 2 || level === 4) {
        const today = int(r, 0, 6);
        const n = level === 1 ? int(r, 8, 20) : level === 2 ? int(r, 21, 60) : int(r, 60, 400);
        const ans = DAYS[(today + n) % 7]!;
        return { prompt: `If today is ${DAYS[today]}, what day of the week will it be ${n} days from today?`, correct: ans, wrong: [DAYS[(today + n + 1) % 7]!, DAYS[(today + n + 6) % 7]!, DAYS[(today + (n % 7) + 2) % 7]!], explanation: `Only the remainder matters: ${n} = 7 × ${Math.floor(n / 7)} + ${n % 7}. ${n % 7} day${n % 7 === 1 ? "" : "s"} after ${DAYS[today]} is ${ans}.` };
      }
      const h = int(r, 1, 11);
      const m = level === 3 ? pick(r, [0, 15, 30, 45]) : pick(r, [10, 20, 25, 35, 40, 50]);
      let angle = Math.abs(30 * h - 5.5 * m);
      if (angle > 180) angle = 360 - angle;
      const naive = Math.abs(30 * h - 6 * m) % 360;
      return { prompt: `What is the smaller angle between the hour and minute hands at ${h}:${String(m).padStart(2, "0")}?`, correct: `${num(angle)}°`, wrong: [`${num(naive > 180 ? 360 - naive : naive)}°`, `${num(360 - angle)}°`, `${num(angle + 5)}°`].filter((w) => w !== `${num(angle)}°`), explanation: `Angle = |30H − 5.5M| = |30 × ${h} − 5.5 × ${m}| = ${num(Math.abs(30 * h - 5.5 * m))}°${Math.abs(30 * h - 5.5 * m) > 180 ? `; the smaller angle is 360 − that = ${num(angle)}°` : ""}. The hour hand moves too: 0.5° a minute.` };
    },
  },
  {
    id: "ages",
    topic: "quant",
    label: "Problems on ages",
    make(r, level) {
      if (level === 1) {
        const b = int(r, 8, 30);
        const d = int(r, 2, 10);
        const total = 2 * b + d;
        return { prompt: `Anu's and Binu's ages add up to ${total} years, and Anu is ${d} years older than Binu. How old is Binu?`, correct: `${b} years`, wrong: [`${b + d} years`, `${num(total / 2)} years`, `${total - d} years`, `${b - 1} years`], explanation: `Binu's age twice, plus ${d}, is ${total}. So twice Binu's age is ${total} − ${d} = ${total - d}, and Binu is ${b}.` };
      }
      if (level === 2) {
        const s = int(r, 4, 15);
        const m = pick(r, [2, 3]);
        const n = int(r, 2, 12);
        const f = m * (s + n) - n;
        return { prompt: `A father is ${f} years old and his son is ${s}. In how many years will the father be ${m} times as old as his son?`, correct: `${n} years`, wrong: [`${n + 1} years`, `${n + 3} years`, `${Math.max(1, n - 2)} years`, `${2 * n} years`], explanation: `In n years: ${f} + n = ${m} × (${s} + n), so ${f} + n = ${m * s} + ${m}n, and ${m - 1}n = ${f - m * s}. That gives n = ${n}.` };
      }
      if (level === 3) {
        const [a, b] = pick(r, [[3, 5], [2, 3], [4, 7], [5, 8], [3, 4], [2, 5]] as const);
        const x = int(r, 2, 8);
        const k = int(r, 1, 3);
        const n = x * k;
        const [c, d] = ratio(a * x + n, b * x + n).split(":").map(Number) as [number, number];
        return {
          prompt: `Anu's and Binu's ages are in the ratio ${a}:${b}. In ${n} years the ratio will be ${ratio(a * x + n, b * x + n)}. How old is Anu now?`,
          correct: `${a * x} years`,
          wrong: [`${b * x} years`, `${a * x + n} years`, `${a * n} years`, `${a * x + x} years`],
          explanation: `Take the ages as ${a}x and ${b}x. Then ${d}(${a}x + ${n}) = ${c}(${b}x + ${n}), so ${times(c * b - d * a, "x")} = ${n * (d - c)} and x = ${x}. Anu is ${a} × ${x} = ${a * x}.`,
        };
      }
      if (level === 4) {
        const t = int(r, 3, 12);
        const k = pick(r, [3, 4, 5]);
        const y = int(r, 3, 8);
        const d = t + y;
        const m = k * t + y;
        return {
          prompt: `A mother's and her daughter's ages add up to ${m + d} years. ${y} years ago, the mother was ${k} times as old as the daughter. How old is the daughter now?`,
          correct: `${d} years`,
          wrong: [`${t} years`, `${num((m + d) / (k + 1))} years`, `${d + y} years`, `${m - d} years`],
          explanation: `${y} years ago their ages added up to ${m + d} − ${2 * y} = ${m + d - 2 * y}, and the mother's was ${k} times the daughter's: the daughter was ${m + d - 2 * y}/${k + 1} = ${t}. Now she is ${t} + ${y} = ${d}.`,
        };
      }
      const b = int(r, 5, 15);
      const k = pick(r, [2, 3]);
      const c = int(r, 2, 6);
      const total = k * b + 2 * b + c;
      return {
        prompt: `A is ${k === 2 ? "twice" : "three times"} as old as B, and B is ${c} years younger than C. Their ages add up to ${total} years. How old is A?`,
        correct: `${k * b} years`,
        wrong: [`${b} years`, `${b + c} years`, `${num(total / 3)} years`, `${k * b + c} years`],
        explanation: `With B's age as b: A = ${k}b and C = b + ${c}. So ${k}b + b + b + ${c} = ${total}, ${k + 2}b = ${total - c}, b = ${b}, and A = ${k * b}.`,
      };
    },
  },
  {
    id: "mixtures",
    topic: "quant",
    label: "Mixtures and alligation",
    make(r, level) {
      if (level <= 2) {
        const [a, b] = pick(r, [[3, 1], [2, 1], [3, 2], [4, 1], [5, 3], [7, 3]] as const);
        const k = int(r, 2, 10);
        const total = (a + b) * k;
        if (level === 1)
          return { prompt: `A ${total}-litre mixture has milk and water in the ratio ${a}:${b}. How much of it is water?`, correct: `${b * k} litres`, wrong: [`${a * k} litres`, `${num(total / b)} litres`, `${k} litres`, `${b * k + k} litres`], explanation: `Water is ${b} part${b > 1 ? "s" : ""} of ${a + b}: ${b}/${a + b} × ${total} = ${b * k} litres.` };
        const e = int(r, 1, 2);
        const [c, d] = ratio(a, b + e).split(":").map(Number) as [number, number];
        return {
          prompt: `A ${total}-litre mixture has milk and water in the ratio ${a}:${b}. How much water must be added to make the ratio ${c}:${d}?`,
          correct: `${e * k} litres`,
          wrong: [`${2 * e * k} litres`, `${e * k + k} litres`, `${num((total * e) / (b + e))} litres`, `${(b + e) * k} litres`],
          explanation: `Milk is ${a}/${a + b} × ${total} = ${a * k} litres, and adding water doesn't change it. For ${c}:${d}, water must be ${a * k} × ${d}/${c} = ${(b + e) * k} litres. There are ${b * k} now, so add ${e * k}.`,
        };
      }
      if (level === 3) {
        const p = int(r, 2, 6) * 10;
        const q = p + int(r, 3, 8) * 10;
        const m = p + int(r, 1, (q - p) / 5 - 1) * 5;
        return {
          prompt: `In what ratio must rice at ₹${p} a kg be mixed with rice at ₹${q} a kg to get a mixture worth ₹${m} a kg?`,
          correct: ratio(q - m, m - p),
          wrong: [ratio(m - p, q - m), ratio(q - p, m - p), ratio(q - m, q - p)],
          explanation: `By alligation, cheaper : dearer = (dearer − mean) : (mean − cheaper) = (${q} − ${m}) : (${m} − ${p}) = ${ratio(q - m, m - p)}.`,
        };
      }
      if (level === 4) {
        const x = int(r, 2, 10);
        let y = int(r, 2, 10);
        if (y === x) y++;
        const p = int(r, 10, 25) * 10;
        // A price gap that makes the mixture's price a whole number of rupees.
        const q = p + (x + y) * int(r, 1, 3) * 5;
        const mean = (x * p + y * q) / (x + y);
        return {
          prompt: `${x} kg of tea at ₹${p} a kg is mixed with ${y} kg of tea at ₹${q} a kg. What is the mixture worth a kg?`,
          correct: rupees(mean),
          wrong: [rupees((p + q) / 2), rupees((x * q + y * p) / (x + y)), rupees(mean + 10), rupees((x * p + y * q) / Math.max(x, y))],
          explanation: `Total cost ${x} × ${p} + ${y} × ${q} = ${x * p + y * q} for ${x + y} kg, so ${num(x * p + y * q)}/${x + y} = ${rupees(mean)} a kg. It's not the plain average of the prices unless the amounts are equal.`,
        };
      }
      const v = pick(r, [20, 40, 50, 80, 100]);
      const f = pick(r, [0.1, 0.2, 0.25]);
      const l = v * f;
      const left = v * (1 - f) ** 2;
      return {
        prompt: `A vessel holds ${v} litres of milk. ${num(l)} litres are taken out and replaced with water, and then this is done once more. How much milk is in the vessel now?`,
        correct: `${num(left)} litres`,
        wrong: [`${num(v - 2 * l)} litres`, `${num(v * (1 - f))} litres`, `${num(v * (1 - f) ** 3)} litres`, `${num(left + l)} litres`],
        explanation: `Each time, ${num(l)}/${v} of what is in the vessel goes, so milk is multiplied by ${num(1 - f)}: ${v} × ${num(1 - f)} × ${num(1 - f)} = ${num(left)} litres. It's not ${v} − 2 × ${num(l)}: the second draw takes out some water too.`,
      };
    },
  },
  {
    id: "pipes",
    topic: "quant",
    label: "Pipes and cisterns",
    make(r, level) {
      // Pairs whose combined time is a whole number of hours.
      const pairs: [number, number, number][] = [
        [3, 6, 2],
        [4, 12, 3],
        [6, 12, 4],
        [10, 15, 6],
        [12, 24, 8],
        [20, 30, 12],
      ];
      if (level === 1) {
        const [a, b, both] = pick(r, pairs);
        return { prompt: `Pipe A fills a tank in ${a} hours and pipe B in ${b} hours. With both open, how long does the empty tank take to fill?`, correct: hours(both), wrong: [hours((a + b) / 2), hours(a + b), hours(b - a), hours(both + 1)], explanation: `In an hour A fills 1/${a} and B 1/${b}. Together 1/${a} + 1/${b} = 1/${both}, so ${hours(both)}.` };
      }
      if (level === 2) {
        const [a, b] = pick(r, [[3, 6], [4, 12], [6, 12], [10, 15], [12, 20], [8, 12], [4, 6], [6, 9]] as const);
        const t = (a * b) / (b - a);
        return { prompt: `Pipe A fills a tank in ${a} hours and pipe B empties it in ${b} hours. With both open, how long does the empty tank take to fill?`, correct: hours(t), wrong: [hours((a * b) / (a + b)), hours(b - a), hours(a + b), hours(t * 2)], explanation: `Each hour the tank gains 1/${a} − 1/${b} = 1/${t}, so it fills in ${hours(t)}.` };
      }
      if (level === 3) {
        const [a, b, c] = pick(r, [[4, 6, 12], [6, 8, 24], [3, 6, 4], [12, 15, 20], [6, 12, 8], [10, 15, 12], [20, 30, 24]] as const);
        const t = 1 / (1 / a + 1 / b - 1 / c);
        return {
          prompt: `Pipes A and B fill a tank in ${a} and ${b} hours, and pipe C empties it in ${c} hours. With all three open, how long does the empty tank take to fill?`,
          correct: hours(t),
          wrong: [hours(1 / (1 / a + 1 / b + 1 / c)), hours(1 / (1 / a + 1 / b)), hours(t + 2), hours(t * 2)],
          explanation: `Each hour: 1/${a} + 1/${b} − 1/${c} = 1/${num(t)} of the tank, so ${hours(t)}. The emptying pipe's share is taken away, not added.`,
        };
      }
      if (level === 4) {
        const [a, b, both] = pick(r, pairs);
        const t = int(r, 1, both - 1);
        const rest = (1 - t / both) * b;
        return {
          prompt: `Pipe A fills a tank in ${a} hours and pipe B in ${b} hours. Both are opened, and after ${hours(t)} A is closed. How much longer does B take to fill the tank?`,
          correct: hours(rest),
          wrong: [hours(b - t), hours((1 - t / both) * a), hours(rest + 1), hours(b - (t * b) / a)],
          explanation: `Together they fill 1/${a} + 1/${b} = 1/${both} an hour, so in ${hours(t)} ${frac(t, both)} is full and ${frac(both - t, both)} is left. B alone needs ${frac(both - t, both)} × ${b} = ${hours(rest)}.`,
        };
      }
      const a = pick(r, [4, 6, 8, 10, 12]);
      const x = pick(r, [1, 2, 4]);
      const leak = (a * (a + x)) / x;
      return {
        prompt: `A pipe fills a tank in ${a} hours, but because of a leak it takes ${a + x} hours. How long would the leak take to empty the full tank?`,
        correct: hours(leak),
        wrong: [hours(x), hours(a * (a + x)), hours(a + x + a), hours(leak / 2)],
        explanation: `The leak empties 1/${a} − 1/${a + x} = ${x}/${a * (a + x)} = 1/${leak} of the tank an hour, so ${hours(leak)}.`,
      };
    },
  },
  {
    id: "boats",
    topic: "quant",
    label: "Boats and streams",
    make(r, level) {
      const b = pick(r, [8, 10, 12, 15, 18, 20]);
      const s = int(r, 2, Math.min(6, b - 3));
      const [down, up] = [b + s, b - s];
      if (level === 1) {
        const t = int(r, 2, 5);
        return { prompt: `A boat goes at ${b} km/h in still water, and the stream flows at ${s} km/h. How long does it take to go ${down * t} km downstream?`, correct: hours(t), wrong: [hours((down * t) / up), hours((down * t) / b), hours(t + 1)], explanation: `Downstream the stream helps: ${b} + ${s} = ${down} km/h. ${down * t}/${down} = ${hours(t)}.` };
      }
      if (level === 2) {
        const stream = r() < 0.5;
        return { prompt: `A boat goes downstream at ${down} km/h and upstream at ${up} km/h. What is the speed of ${stream ? "the stream" : "the boat in still water"}?`, correct: `${stream ? s : b} km/h`, wrong: [`${stream ? b : s} km/h`, `${down - up} km/h`, `${down + up} km/h`], explanation: `Still water = (down + up)/2 = (${down} + ${up})/2 = ${b} km/h. Stream = (down − up)/2 = (${down} − ${up})/2 = ${s} km/h.` };
      }
      if (level === 3) {
        const [t1, t2] = [int(r, 2, 4), int(r, 2, 4)];
        return {
          prompt: `A boat covers ${down * t1} km downstream in ${t1} hours and ${up * t2} km upstream in ${t2} hours. What is its speed in still water?`,
          correct: `${b} km/h`,
          wrong: [`${s} km/h`, `${num((down * t1 + up * t2) / (t1 + t2))} km/h`, `${down} km/h`, `${up} km/h`],
          explanation: `Downstream speed ${down * t1}/${t1} = ${down} km/h, upstream ${up * t2}/${t2} = ${up} km/h. Still water is their average, (${down} + ${up})/2 = ${b} km/h.`,
        };
      }
      if (level === 4) {
        // Speeds whose round trips come out in whole kilometres and sensible hours.
        const [b, s] = pick(r, [[10, 2], [9, 3], [12, 4], [15, 5], [7, 3], [8, 2], [6, 2]] as const);
        const [down, up] = [b + s, b - s];
        const d = ((down * up) / gcd(down, up)) * int(r, 1, 2);
        const t = d / down + d / up;
        return {
          prompt: `A man rows to a place ${d} km away and back. He rows at ${b} km/h in still water and the stream flows at ${s} km/h. How long does the round trip take?`,
          correct: hours(t),
          wrong: [hours((2 * d) / b), hours(d / down), hours(t + 1), hours((2 * d) / down)],
          explanation: `Downstream at ${down} km/h takes ${hours(d / down)}; upstream at ${up} km/h takes ${hours(d / up)}. Together ${hours(t)}, more than ${num((2 * d) / b)}: the slow leg costs more than the fast one saves.`,
        };
      }
      const k = pick(r, [2, 3]);
      const boat = (s * (k + 1)) / (k - 1);
      return {
        prompt: `A boat takes ${k === 2 ? "twice" : "three times"} as long to go a distance upstream as to go the same distance downstream. The stream flows at ${s} km/h. What is the boat's speed in still water?`,
        correct: `${boat} km/h`,
        wrong: [`${k * s} km/h`, `${s * (k + 1)} km/h`, `${boat + s} km/h`, `${boat - 1} km/h`],
        explanation: `Same distance, so the speeds are in the reverse ratio of the times: (b + ${s}) = ${k}(b − ${s}). That gives ${k === 2 ? `b = ${boat}` : `${k - 1}b = ${s * (k + 1)}, b = ${boat}`} km/h.`,
      };
    },
  },
  {
    id: "permutations",
    topic: "quant",
    label: "Permutations and combinations",
    make(r, level) {
      if (level === 1) {
        const n = int(r, 4, 7);
        return { prompt: `In how many ways can ${n} students stand in a row?`, correct: String(fact(n)), wrong: [String(fact(n - 1)), String(n * n), String(n * (n - 1)), String(fact(n) / 2)], explanation: `The first place has ${n} choices, the next ${n - 1}, and so on: ${n}! = ${Array.from({ length: n }, (_, i) => n - i).join(" × ")} = ${fact(n)}.` };
      }
      if (level === 2) {
        const n = int(r, 6, 10);
        const k = int(r, 2, 4);
        const c = choose(n, k);
        return { prompt: `In how many ways can a team of ${k} be chosen from ${n} students?`, correct: String(c), wrong: [String(fact(n) / fact(n - k)), String(choose(n, k - 1)), String(n * k), String(c + n)], explanation: `Order doesn't matter in a team, so it's ${n}C${k} = ${n}! / (${k}! × ${n - k}!) = ${c}.` };
      }
      if (level === 3) {
        const word = pick(r, ["APPLE", "LEVEL", "BANANA", "COFFEE", "LETTER", "SUCCESS", "CANADA", "ATTEMPT", "BALLOON"]);
        const counts = new Map<string, number>();
        for (const ch of word) counts.set(ch, (counts.get(ch) ?? 0) + 1);
        const reps = [...counts].filter(([, c]) => c > 1);
        const ways = fact(word.length) / reps.reduce((p, [, c]) => p * fact(c), 1);
        return {
          prompt: `In how many different ways can the letters of the word ${word} be arranged?`,
          correct: String(ways),
          wrong: [String(fact(word.length)), String(fact(word.length) / 2), String(ways * 2), String(fact(word.length - 1))],
          explanation: `${word.length} letters, with ${reps.map(([ch, c]) => `${ch} ${c} times`).join(" and ")}. Swapping the same letters gives nothing new, so ${word.length}! / (${reps.map(([, c]) => `${c}!`).join(" × ")}) = ${ways}.`,
        };
      }
      const men = int(r, 4, 7);
      const women = int(r, 3, 6);
      if (level === 4) {
        const x = int(r, 2, 3);
        const y = int(r, 1, 2);
        const ways = choose(men, x) * choose(women, y);
        return {
          prompt: `A committee of ${x} men and ${y} wom${y > 1 ? "en" : "an"} is to be chosen from ${men} men and ${women} women. In how many ways can it be done?`,
          correct: String(ways),
          wrong: [String(choose(men + women, x + y)), String(choose(men, x) + choose(women, y)), String(choose(men, x) * women * y + 1), String(ways * 2)],
          explanation: `Choose the men and the women separately and multiply: ${men}C${x} × ${women}C${y} = ${choose(men, x)} × ${choose(women, y)} = ${ways}.`,
        };
      }
      const k = int(r, 3, 4);
      const all = choose(men + women, k);
      const none = choose(men, k);
      return {
        prompt: `A committee of ${k} is to be chosen from ${men} men and ${women} women, with at least one woman. In how many ways can it be done?`,
        correct: String(all - none),
        wrong: [String(all), String(women * choose(men + women - 1, k - 1)), String(all - choose(women, k)), String(all - none + men)],
        explanation: `Count every committee and take away those with no women: ${men + women}C${k} − ${men}C${k} = ${all} − ${none} = ${all - none}. Picking "one woman, then anyone" counts some committees more than once.`,
      };
    },
  },
  {
    id: "probability",
    topic: "quant",
    label: "Probability",
    make(r, level) {
      if (level === 1) {
        const k = int(r, 1, 4);
        return { prompt: `A fair die is thrown. What is the probability of getting a number greater than ${k}?`, correct: frac(6 - k, 6), wrong: [frac(k, 6), frac(Math.max(1, 5 - k), 6), frac(1, 6), frac(1, 2), frac(1, 3), frac(2, 3), frac(5, 6)], explanation: `The numbers greater than ${k} are ${Array.from({ length: 6 - k }, (_, i) => k + 1 + i).join(", ")}: ${6 - k} of the 6 outcomes, so ${frac(6 - k, 6)}.` };
      }
      if (level === 2) {
        const [red, blue, green] = [int(r, 2, 9), int(r, 2, 9), int(r, 2, 9)];
        const n = red + blue + green;
        return { prompt: `A bag has ${red} red, ${blue} blue and ${green} green balls. One ball is drawn at random. What is the probability that it is not red?`, correct: frac(blue + green, n), wrong: [frac(red, n), frac(blue, n), frac(green, n), frac(blue + green, n + 1), frac(blue + green - 1, n), frac(1, 2)], explanation: `${blue + green} of the ${n} balls are not red, so ${frac(blue + green, n)}.` };
      }
      if (level === 3) {
        const s = pick(r, [3, 4, 5, 6, 8, 9, 10, 11]);
        const ways = 6 - Math.abs(s - 7);
        const pairs = Array.from({ length: 6 }, (_, i) => i + 1).filter((a) => s - a >= 1 && s - a <= 6).map((a) => `(${a}, ${s - a})`);
        return { prompt: `Two fair dice are thrown. What is the probability that the numbers add up to ${s}?`, correct: frac(ways, 36), wrong: [frac(1, 11), frac(ways, 12), frac(ways + 1, 36), frac(s - 1, 36)], explanation: `There are 36 equally likely outcomes. ${ways} give ${s}: ${pairs.join(", ")}. So ${ways}/36${frac(ways, 36) === `${ways}/36` ? "" : ` = ${frac(ways, 36)}`}.` };
      }
      if (level === 4) {
        const red = int(r, 3, 7);
        const blue = int(r, 2, 7);
        const n = red + blue;
        return {
          prompt: `A bag has ${red} red and ${blue} blue balls. Two balls are drawn at random, without putting the first back. What is the probability that both are red?`,
          correct: frac(choose(red, 2), choose(n, 2)),
          wrong: [frac(red * red, n * n), frac(red, n), frac(choose(red, 2), n * n), frac(red - 1, n - 1)],
          explanation: `${red}/${n} for the first, then ${red - 1}/${n - 1} for the second: ${red * (red - 1)}/${n * (n - 1)} = ${frac(choose(red, 2), choose(n, 2))}. The same as ${red}C2 / ${n}C2.`,
        };
      }
      const [what, count, naive, overlap] = pick(r, [
        ["a king or a heart", 16, 17, "the king of hearts"],
        ["a face card (jack, queen or king) or a spade", 22, 25, "the three face cards in spades"],
        ["a red card or an ace", 28, 30, "the two red aces"],
        ["a queen or a club", 16, 17, "the queen of clubs"],
        ["a black card or a king", 28, 30, "the two black kings"],
        ["a diamond or a face card", 22, 25, "the three face cards in diamonds"],
      ] as const);
      return {
        prompt: `One card is drawn from a well-shuffled pack of 52. What is the probability that it is ${what}?`,
        correct: frac(count, 52),
        wrong: [frac(naive, 52), frac(count - 4, 52), frac(count + 4, 52), frac(13, 52)],
        explanation: `Add the two groups and take away the cards counted twice (${overlap}): ${naive} − ${naive - count} = ${count} cards, so ${count}/52 = ${frac(count, 52)}.`,
      };
    },
  },
  {
    id: "data-interpretation",
    topic: "quant",
    label: "Data interpretation",
    make(r, level) {
      const stores = ["North", "South", "East", "West"];
      const years = ["2023", "2024", "2025"];
      const step = level <= 2 ? 10 : 20;
      // Different numbers in each year, so "which sold the most" has one answer.
      const cols = years.map(() => {
        const s = new Set<number>();
        while (s.size < 4) s.add(int(r, 6, 30) * step);
        return [...s];
      });
      const i = int(r, 0, 3);
      const y = int(r, 0, 2);
      let p = 0;
      if (level === 4) {
        p = pick(r, [10, 20, 25, 40, 50, -10, -20, -25]);
        cols[2]![i] = cols[0]![i]! * (1 + p / 100);
      }
      const j = (i + int(r, 1, 3)) % 4;
      const total = (k: number) => cols.reduce((sum, c) => sum + c[k]!, 0);
      if (level === 5) {
        // Nudge the middle year so the two totals make a ratio worth asking about.
        for (const [a, b] of shuffled(r, [[3, 2], [4, 3], [5, 4], [2, 3], [3, 4], [4, 5], [5, 3], [3, 5]] as const)) {
          const mid = (total(j) * a) / b - cols[0]![i]! - cols[2]![i]!;
          if (Number.isInteger(mid / step) && mid >= 3 * step && mid <= 40 * step) {
            cols[1]![i] = mid;
            break;
          }
        }
        while (total(i) === total(j)) cols[0]![i] = cols[0]![i]! + step;
      }
      const table = { caption: "Laptops sold by four stores", columns: ["Store", ...years], rows: stores.map((s, k) => [s, ...cols.map((c) => String(c[k]))]) };
      const intro = "The table shows the laptops four stores sold each year.";
      const v = (k: number, yr: number) => cols[yr]![k]!;
      if (level === 1) {
        const t = total(i);
        return { table, prompt: `${intro} How many did the ${stores[i]} store sell over the three years?`, correct: String(t), wrong: [String(t - v(i, 2)), String(t + step), String(cols[y]!.reduce((a, b) => a + b, 0)), String(t - step)], explanation: `${cols.map((c) => c[i]).join(" + ")} = ${t}.` };
      }
      if (level === 2) {
        const col = cols[y]!;
        const best = col.indexOf(Math.max(...col));
        return { table, prompt: `${intro} Which store sold the most in ${years[y]}?`, correct: stores[best]!, wrong: stores.filter((_, k) => k !== best), explanation: `In ${years[y]}: ${stores.map((s, k) => `${s} ${col[k]}`).join(", ")}. The highest is ${stores[best]}, with ${col[best]}.` };
      }
      if (level === 3) {
        const sum = cols[y]!.reduce((a, b) => a + b, 0);
        const other = cols[(y + 1) % 3]!.reduce((a, b) => a + b, 0);
        return { table, prompt: `${intro} What was the average a store sold in ${years[y]}?`, correct: num(sum / 4), wrong: [num(sum / 3), num(sum), num(other / 4), num(sum / 4 + step / 2)], explanation: `Total for ${years[y]}: ${cols[y]!.join(" + ")} = ${sum}. Over 4 stores: ${sum}/4 = ${num(sum / 4)}.` };
      }
      if (level === 4) {
        const [from, to] = [v(i, 0), v(i, 2)];
        const show = (x: number) => `${num(Math.abs(x))}% ${x >= 0 ? "increase" : "decrease"}`;
        return {
          table,
          prompt: `${intro} By what percent did the ${stores[i]} store's sales change from 2023 to 2025?`,
          correct: show(p),
          wrong: [show(-p), show(((to - from) / to) * 100), show(p + 5), show(p / 2)],
          explanation: `Change ${to} − ${from} = ${to - from}, on the 2023 figure: ${to - from}/${from} × 100 = ${show(p)}.`,
        };
      }
      const [ti, tj] = [total(i), total(j)];
      return {
        table,
        prompt: `${intro} What is the ratio of the ${stores[i]} store's sales to the ${stores[j]} store's, over the three years?`,
        correct: ratio(ti, tj),
        wrong: [ratio(tj, ti), ratio(v(i, 2), v(j, 2)), ratio(ti + step, tj), ratio(ti, tj + step)],
        explanation: `${stores[i]}: ${cols.map((c) => c[i]).join(" + ")} = ${ti}. ${stores[j]}: ${cols.map((c) => c[j]).join(" + ")} = ${tj}. ${ti}:${tj} = ${ratio(ti, tj)}.`,
      };
    },
  },
  {
    id: "blood-relations",
    topic: "reasoning",
    label: "Blood relations",
    make(r, level) {
      if (level === 3) {
        const [prompt, correct, explanation] = pick(r, [
          ["P is the wife of Q. Q is the brother of R. How is P related to R?", "Sister-in-law", "P is married to R's brother, so P is R's sister-in-law."],
          ["P is the son of Q. Q is the sister of R. How is P related to R?", "Nephew", "P's mother Q is R's sister, so P is R's nephew."],
          ["P is the daughter of Q. Q is the brother of R. How is P related to R?", "Niece", "P's father Q is R's brother, so P is R's niece."],
          ["P is the husband of Q. Q is the daughter of R. How is P related to R?", "Son-in-law", "P is married to R's daughter, so P is R's son-in-law."],
          ["P, a woman, points to a boy and says, \"He is the son of my mother's only son.\" How is the boy related to P?", "Nephew", "P is a woman, so her mother's only son is her brother. The boy is her brother's son: her nephew."],
          ["Q, a man, points to a woman and says, \"Her father is my father's only son.\" How is the woman related to Q?", "Daughter", "Q's father's only son is Q himself, so the woman's father is Q: she is his daughter."],
          ["P is the mother of Q. Q is the wife of R. How is P related to R?", "Mother-in-law", "P's daughter Q is married to R, so P is R's mother-in-law."],
        ] as const);
        const pool = RELATIONS[RELATIONS.male.includes(correct) ? "male" : "female"];
        return { prompt, correct, wrong: shuffled(r, pool.filter((x) => x !== correct)), explanation };
      }
      // A chain of "is the mother / father / brother / sister of", in words or (level 4 up) in a code.
      const steps = level === 2 || level === 5 ? 3 : 2;
      const people = ["A", "B", "C", "D"];
      let chain: typeof LINKS = [];
      for (let tries = 0; tries < 50; tries++) {
        chain = Array.from({ length: steps }, () => pick(r, LINKS));
        if (chain.every((_, k) => relOf(chain.slice(0, k + 1)))) break;
      }
      if (!relOf(chain)) chain = [LINKS[0]!, LINKS[2]!]; // mother of a brother: mother
      const result = relOf(chain)!;
      const answer = relName(result);
      const statements = chain.map((l, k) => `${people[k]} is the ${l.word} of ${people[k + 1]}`);
      const sofar = chain.map((_, k) => relName(relOf(chain.slice(0, k + 1))!).toLowerCase());
      const working = statements.map((s, k) => (k === 0 ? `${s}.` : `${s}, so A is ${people[k + 1]}'s ${sofar[k]}.`)).join(" ");
      const pool = RELATIONS[result.g === "m" ? "male" : "female"];
      const wrong = shuffled(r, pool.filter((x) => x !== answer));
      const last = people[steps]!;
      if (level <= 2) return { prompt: `${statements.join(". ")}. How is A related to ${last}?`, correct: answer, wrong, explanation: working };
      const symbols = shuffled(r, ["+", "−", "×", "÷"]);
      const code = new Map(LINKS.map((l, k) => [l.word, symbols[k]!] as const));
      const legend = LINKS.map((l) => `X ${code.get(l.word)} Y means X is the ${l.word} of Y.`).join("\n");
      const expr = chain.map((l, k) => `${people[k]} ${code.get(l.word)} `).join("") + last;
      return { prompt: `In a code:\n${legend}\nIf ${expr}, how is A related to ${last}?`, correct: answer, wrong, explanation: `Reading the code: ${working}` };
    },
  },
  {
    id: "syllogisms",
    topic: "reasoning",
    label: "Syllogisms",
    make(r, level) {
      const words = shuffled(r, ["pens", "books", "cups", "doors", "keys", "birds", "trees", "phones", "chairs", "lamps"]);
      const k = level === 5 ? 4 : 3;
      const kinds: Claim["kind"][] = level === 1 ? ["all"] : level === 2 ? ["all", "no"] : level === 3 ? ["all", "no", "some"] : ["all", "no", "some", "some-not"];
      const answers = ["Only conclusion I follows", "Only conclusion II follows", "Both conclusions follow", "Neither conclusion follows"];
      for (;;) {
        // Premises link each group to the next, in either order.
        const premises: Claim[] = Array.from({ length: k - 1 }, (_, t) => {
          const [a, b] = r() < 0.5 ? [t, t + 1] : [t + 1, t];
          // Level 1 and 2 keep the first link an "all", so there is something to conclude.
          return { kind: t === 0 && level <= 2 ? "all" : pick(r, kinds), a, b };
        });
        const models = venn(k, premises);
        if (!models.length) continue;
        const said = (c: Claim) => premises.some((p) => p.kind === c.kind && p.a === c.a && p.b === c.b);
        const candidates: Claim[] = [];
        for (const kind of ["all", "no", "some", "some-not"] as const)
          for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) if (a !== b && !said({ kind, a, b })) candidates.push({ kind, a, b });
        const valid = candidates.filter((c) => models.every((m) => holds(k, m, c)));
        const invalid = candidates.filter((c) => !models.every((m) => holds(k, m, c)));
        // Each answer about as often, among those these premises can give.
        const feasible = [0, 1, 2, 3].filter((w) => (w < 2 ? valid.length && invalid.length : (w === 2 ? valid : invalid).length >= 2));
        if (!feasible.length) continue;
        const want = pick(r, feasible);
        const [first, second] = want === 2 ? shuffled(r, valid) : want === 3 ? shuffled(r, invalid) : want === 0 ? [pick(r, valid), pick(r, invalid)] : [pick(r, invalid), pick(r, valid)];
        const why = (c: Claim, n: string) => {
          const [x, y] = [words[c.a]!, words[c.b]!];
          if (valid.includes(c)) return `${n} follows: however the groups are drawn to fit the statements, it is true.`;
          const counter = { all: `some ${x} that are not ${y}`, no: `some ${x} to be ${y}`, some: `no ${x} to be ${y}`, "some-not": `every one of the ${x} to be ${y}` }[c.kind];
          return `${n} doesn't follow: the statements allow ${counter}.`;
        };
        return {
          prompt: `Statements: ${premises.map((p) => claim(p, words)).join(" ")}\nConclusions: I. ${claim(first!, words)} II. ${claim(second!, words)}\nWhich follow?`,
          correct: answers[want]!,
          wrong: answers.filter((_, n) => n !== want),
          explanation: `${why(first!, "I")} ${why(second!, "II")} Take the statements as true, even if they sound odd, and use nothing else.`,
        };
      }
    },
  },
];

export const APTITUDE_TEMPLATES = TEMPLATES.map(({ id, topic, label }) => ({ id, topic, label }));
export const APTITUDE_LEVELS = [1, 2, 3, 4, 5] as const;

/** "1 days" as "1 day", wherever a computed number lands on one. */
function singular(m: Made): Made {
  const fix = (x: string) => x.replace(/(?<![\d.])1 (hour|year|day|litre|second)s\b/g, "1 $1");
  return { ...m, prompt: fix(m.prompt), correct: fix(m.correct), wrong: m.wrong.map(fix), explanation: fix(m.explanation) };
}

/** Rebuild a question from its template, level and seed: the same inputs always give the same question. */
export function generateQuestion(templateId: string, level: number, seed: number): GeneratedQuestion {
  const t = TEMPLATES.find((x) => x.id === templateId);
  if (!t) throw new Error(`No aptitude template ${templateId}`);
  const lvl = Math.min(5, Math.max(1, Math.round(level)));
  const r = seededRandom(seed);
  const made = singular(t.make(r, lvl));
  // Four options: the answer and three distinct wrong ones, padded if the slips coincide.
  const wrong: string[] = [];
  for (const w of made.wrong) if (w !== made.correct && !wrong.includes(w) && wrong.length < 3) wrong.push(w);
  for (let i = 1; wrong.length < 3; i++) {
    const m = made.correct.match(/-?\d+(\.\d+)?/);
    const alt = m ? made.correct.replace(m[0], num(Number(m[0]) + i * (Number(m[0]) >= 10 ? Math.ceil(Number(m[0]) / 10) : 1))) : `${made.correct} (${i})`;
    if (alt !== made.correct && !wrong.includes(alt)) wrong.push(alt);
  }
  const options = [made.correct, ...wrong];
  // Shuffle with the same seed, so the order is part of the question.
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [options[i], options[j]] = [options[j]!, options[i]!];
  }
  return { template: t.id, level: lvl, seed, prompt: made.prompt, options, answer: options.indexOf(made.correct), explanation: made.explanation, ...(made.table ? { table: made.table } : {}) };
}
