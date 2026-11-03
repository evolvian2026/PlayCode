import type { Difficulty } from "@playcode/core";
import { concept } from "./fundamentals";
import type { SeedQuestion } from "./questions";
import type { SeedSkill } from "./skills";

// Aptitude for service-company tests (TCS NQT, Infosys, Wipro, Accenture,
// Capgemini): quantitative aptitude and logical reasoning. Every question whose
// answer can be computed has a Python program that prints the correct option,
// so `pnpm verify:content` proves the key.

export const APTITUDE_SKILLS: SeedSkill[] = [
  { id: "aptitude.arithmetic", topic: "aptitude", topicName: "Quantitative aptitude", name: "Percentages, profit and interest" },
  { id: "aptitude.time", topic: "aptitude", topicName: "Quantitative aptitude", name: "Time, speed and work" },
  { id: "aptitude.numbers", topic: "aptitude", topicName: "Quantitative aptitude", name: "Number system" },
  { id: "reasoning.series", topic: "reasoning", topicName: "Logical reasoning", name: "Series and odd one out" },
  { id: "reasoning.puzzles", topic: "reasoning", topicName: "Logical reasoning", name: "Coding, directions and arrangements" },
];

const q = (
  id: string,
  skillId: string,
  difficulty: Difficulty,
  stem: string,
  explanation: string,
  options: string[],
  verify?: string,
  hints?: string[],
): SeedQuestion => concept({ id, skillId, difficulty, stem, explanation, verify, hints, tag: "service_aptitude" }, options, 0);

export const APTITUDE_QUESTIONS: SeedQuestion[] = [
  // ---------------- Percentages, profit and interest ----------------
  q(
    "apt-arith-1", "aptitude.arithmetic", 1,
    "A shirt's price goes up by 20% and then comes down by 20%. What is the net change in its price?",
    "100 becomes 120, then 120 less 20% (24) is 96: a 4% decrease. A rise and an equal fall in percent always end lower.",
    ["4% decrease", "No change", "4% increase", "2% decrease"],
    `price = 100 * 1.2 * 0.8
print(f"{round(100 - price)}% decrease")`,
    ["Start from 100 and apply each change in turn."],
  ),
  q(
    "apt-arith-2", "aptitude.arithmetic", 1,
    "A trader buys an article for ₹800 and sells it for ₹920. What is the profit percentage?",
    "Profit is 120 on a cost of 800: 120 / 800 × 100 = 15%. Profit percent is always on the cost price.",
    ["15%", "13%", "12%", "20%"],
    `print(f"{(920 - 800) / 800 * 100:g}%")`,
  ),
  q(
    "apt-arith-3", "aptitude.arithmetic", 1,
    "₹1,200 is divided between A and B in the ratio 3 : 5. How much does B get?",
    "There are 3 + 5 = 8 parts of ₹150 each; B gets 5 parts = ₹750.",
    ["₹750", "₹450", "₹720", "₹800"],
    `print(f"₹{1200 * 5 // (3 + 5)}")`,
  ),
  q(
    "apt-arith-4", "aptitude.arithmetic", 2,
    "What is the simple interest on ₹5,000 at 8% a year for 3 years?",
    "Simple interest = P × R × T / 100 = 5000 × 8 × 3 / 100 = ₹1,200.",
    ["₹1,200", "₹1,298", "₹400", "₹1,500"],
    `print(f"₹{5000 * 8 * 3 // 100:,}")`,
  ),
  q(
    "apt-arith-5", "aptitude.arithmetic", 2,
    "What is the compound interest on ₹10,000 at 10% a year for 2 years, compounded yearly?",
    "Amount = 10000 × 1.1 × 1.1 = 12,100, so the interest is ₹2,100 (₹100 more than simple interest, the interest on the first year's interest).",
    ["₹2,100", "₹2,000", "₹1,100", "₹2,210"],
    `from fractions import Fraction
amount = 10000 * Fraction(11, 10) ** 2
print(f"₹{int(amount - 10000):,}")`,
  ),

  // ---------------- Time, speed and work ----------------
  q(
    "apt-time-1", "aptitude.time", 1,
    "A train 150 m long passes a pole in 10 seconds. What is its speed in km/h?",
    "Speed = 150 / 10 = 15 m/s, and 15 × 18/5 = 54 km/h. To cross a pole, a train covers its own length.",
    ["54 km/h", "15 km/h", "45 km/h", "60 km/h"],
    `print(f"{150 / 10 * 18 / 5:g} km/h")`,
    ["m/s to km/h: multiply by 18/5."],
  ),
  q(
    "apt-time-2", "aptitude.time", 2,
    "A can finish a job in 12 days and B in 18 days. Working together, how many days do they take?",
    "Together they do 1/12 + 1/18 = 5/36 of the job a day, so they need 36/5 = 7.2 days.",
    ["7.2 days", "15 days", "6 days", "7.5 days"],
    `from fractions import Fraction
print(f"{float(1 / (Fraction(1, 12) + Fraction(1, 18))):g} days")`,
    ["Add the work each does in one day."],
  ),
  q(
    "apt-time-3", "aptitude.time", 2,
    "A car covers the first half of a journey at 40 km/h and the second half at 60 km/h. What is its average speed for the whole journey?",
    "For equal distances, the average speed is 2xy / (x + y) = 2 × 40 × 60 / 100 = 48 km/h, not 50: the car spends longer at the slower speed.",
    ["48 km/h", "50 km/h", "45 km/h", "52 km/h"],
    `print(f"{2 * 40 * 60 / (40 + 60):g} km/h")`,
  ),
  q(
    "apt-time-4", "aptitude.time", 3,
    "Two trains, 120 m and 180 m long, run on parallel tracks in opposite directions at 50 km/h and 40 km/h. How long do they take to cross each other?",
    "Relative speed is 50 + 40 = 90 km/h = 25 m/s, the distance is 120 + 180 = 300 m, so 300 / 25 = 12 seconds.",
    ["12 seconds", "30 seconds", "10 seconds", "15 seconds"],
    `print(f"{(120 + 180) / ((50 + 40) * 5 / 18):g} seconds")`,
  ),

  // ---------------- Number system ----------------
  q(
    "apt-num-1", "aptitude.numbers", 2,
    "What is the remainder when 2^100 is divided by 7?",
    "2^3 = 8 leaves remainder 1, so 2^99 = (2^3)^33 leaves 1, and 2^100 = 2 × 2^99 leaves 2.",
    ["2", "1", "4", "0"],
    `print(pow(2, 100, 7))`,
    ["Find a small power of 2 that leaves remainder 1."],
  ),
  q(
    "apt-num-2", "aptitude.numbers", 1,
    "What is the LCM of 12, 18 and 30?",
    "12 = 2² × 3, 18 = 2 × 3², 30 = 2 × 3 × 5. Take the highest power of each prime: 2² × 3² × 5 = 180.",
    ["180", "360", "90", "6"],
    `import math
print(math.lcm(12, 18, 30))`,
  ),
  q(
    "apt-num-3", "aptitude.numbers", 2,
    "How many whole numbers from 1 to 100 are divisible by 3 or by 5?",
    "33 multiples of 3 plus 20 of 5, minus the 6 multiples of 15 counted twice: 33 + 20 - 6 = 47.",
    ["47", "53", "33", "40"],
    `print(sum(1 for n in range(1, 101) if n % 3 == 0 or n % 5 == 0))`,
  ),
  q(
    "apt-num-4", "aptitude.numbers", 2,
    "What is the units digit of 7^95?",
    "Units digits of powers of 7 repeat 7, 9, 3, 1. 95 leaves remainder 3 when divided by 4, so the digit is the third in the cycle: 3.",
    ["3", "7", "9", "1"],
    `print(pow(7, 95, 10))`,
  ),

  // ---------------- Series and odd one out ----------------
  q(
    "rsn-series-1", "reasoning.series", 1,
    "What comes next: 2, 6, 12, 20, 30, ?",
    "The terms are 1×2, 2×3, 3×4, 4×5, 5×6, so the next is 6×7 = 42. (The gaps grow by 2: 4, 6, 8, 10, 12.)",
    ["42", "40", "36", "44"],
    `print(6 * 7)`,
  ),
  q(
    "rsn-series-2", "reasoning.series", 1,
    "What comes next: 3, 9, 27, 81, ?",
    "Each term is three times the one before: 81 × 3 = 243.",
    ["243", "162", "108", "324"],
    `print(81 * 3)`,
  ),
  q(
    "rsn-series-3", "reasoning.series", 1,
    "What comes next: 1, 1, 2, 3, 5, 8, ?",
    "Each term is the sum of the two before it (the Fibonacci series): 5 + 8 = 13.",
    ["13", "11", "12", "16"],
    `a, b = 5, 8
print(a + b)`,
  ),
  q(
    "rsn-series-4", "reasoning.series", 2,
    "What comes next: AZ, BY, CX, ?",
    "The first letter moves forward from A, the second backward from Z: D and W.",
    ["DW", "DX", "EW", "DV"],
    `print(chr(ord("A") + 3) + chr(ord("Z") - 3))`,
  ),
  q(
    "rsn-series-5", "reasoning.series", 1,
    "Which is the odd one out: 121, 144, 169, 196, 210?",
    "121, 144, 169 and 196 are squares of 11, 12, 13 and 14; 210 isn't a perfect square.",
    ["210", "121", "169", "196"],
    `import math
print(next(n for n in [121, 144, 169, 196, 210] if math.isqrt(n) ** 2 != n))`,
  ),

  // ---------------- Coding, directions and arrangements ----------------
  q(
    "rsn-puzzle-1", "reasoning.puzzles", 1,
    "If CAT is written as DBU in a code, how is DOG written?",
    "Each letter moves one place forward: D→E, O→P, G→H, so DOG is EPH.",
    ["EPH", "EOH", "CNF", "FQI"],
    `print("".join(chr(ord(c) + 1) for c in "DOG"))`,
  ),
  q(
    "rsn-puzzle-2", "reasoning.puzzles", 2,
    "In a code, each letter is replaced by the letter two places before it, so FIRE becomes DGPC. What does JUMP become?",
    "J→H, U→S, M→K, P→N: HSKN.",
    ["HSKN", "LWOR", "HTKN", "ISLO"],
    `print("".join(chr(ord(c) - 2) for c in "JUMP"))`,
  ),
  q(
    "rsn-puzzle-3", "reasoning.puzzles", 2,
    "Ravi walks 5 km north, turns right and walks 3 km, then turns right again and walks 5 km. How far is he from where he started, and in which direction?",
    "North 5, then east 3, then south 5 brings him back level with the start, 3 km to the east.",
    ["3 km east", "3 km west", "5 km north", "8 km east"],
    `x, y = 0, 0
y += 5   # north
x += 3   # right of north is east
y -= 5   # right of east is south
print(f"{abs(x)} km {'east' if x > 0 else 'west'}")`,
    ["Track the east-west and north-south distances separately."],
  ),
  q(
    "rsn-puzzle-4", "reasoning.puzzles", 2,
    "Pointing to a man, Meera says, \"His mother is the only daughter of my mother.\" How is the man related to Meera?",
    "The only daughter of Meera's mother is Meera herself, so the man's mother is Meera: he is her son.",
    ["Son", "Brother", "Nephew", "Cousin"],
  ),
  q(
    "rsn-puzzle-5", "reasoning.puzzles", 3,
    "Five friends sit in a row facing north. E is at the left end and C at the right end. A is somewhere to the left of B, and D sits exactly between A and B. Who sits in the middle?",
    "With E first and C fifth, A, D and B fill seats 2, 3 and 4 in that order (D between, A to the left), so D is in the middle.",
    ["D", "A", "B", "E"],
    `from itertools import permutations
for row in permutations("ABCDE"):
    pos = {p: i for i, p in enumerate(row)}
    if pos["E"] == 0 and pos["C"] == 4 and pos["A"] < pos["B"] and pos["B"] - pos["A"] == 2 and pos["D"] == pos["A"] + 1:
        print(row[2])
        break`,
  ),
];
