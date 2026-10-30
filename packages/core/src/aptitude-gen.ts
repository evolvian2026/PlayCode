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
}

type Rand = () => number;
interface Made {
  prompt: string;
  correct: string;
  /** Plausible wrong answers, from the usual slips; more than three is fine. */
  wrong: string[];
  explanation: string;
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
        prompt: `A can finish a job in ${a} days and B in ${b} days. A works alone for ${first} days and then B finishes the rest. How many days does B work?`,
        correct: `${num(bDays)} days`,
        wrong: [`${b - first} days`, `${num(left * a)} days`, `${num(bDays + 1)} days`, `${num((1 - first / b) * b)} days`].filter((w) => w !== `${num(bDays)} days`),
        explanation: `In ${first} days A does ${frac(first, a)} of the job, leaving ${frac(a - first, a)}. B does 1/${b} a day, so B needs ${frac(a - first, a)} × ${b} = ${num(bDays)} days.`,
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
];

export const APTITUDE_TEMPLATES = TEMPLATES.map(({ id, topic, label }) => ({ id, topic, label }));
export const APTITUDE_LEVELS = [1, 2, 3, 4, 5] as const;

/** Rebuild a question from its template, level and seed: the same inputs always give the same question. */
export function generateQuestion(templateId: string, level: number, seed: number): GeneratedQuestion {
  const t = TEMPLATES.find((x) => x.id === templateId);
  if (!t) throw new Error(`No aptitude template ${templateId}`);
  const lvl = Math.min(5, Math.max(1, Math.round(level)));
  const r = seededRandom(seed);
  const made = t.make(r, lvl);
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
  return { template: t.id, level: lvl, seed, prompt: made.prompt, options, answer: options.indexOf(made.correct), explanation: made.explanation };
}
