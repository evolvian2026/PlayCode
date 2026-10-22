import type { Answer, Difficulty, Language, Option, ParsonsLine, Question, QuestionType } from "@playcode/core";

// Starter question bank. Every question with a `verify` block is executed by
// `pnpm verify:content` (and in CI) to prove its stated answer is what the
// code really prints. Option ids are a, b, c, d in authored order.

export interface Verify {
  runner: "python" | "c" | "java";
  /** Full program. Defaults to the question's code (Python) plus `harness`. */
  program?: string;
  /** Appended to the program (Parsons: appended to the correct lines). */
  harness?: string;
  /** Expected stdout. Defaults to the correct option text or first accepted answer. */
  expected?: string;
}

export interface SeedQuestion extends Question {
  verify?: Verify;
  tags?: string[];
}

/** Template tag for code: keeps backslashes, trims the first newline and trailing space. */
const code = (s: TemplateStringsArray, ...v: unknown[]) => String.raw(s, ...v).replace(/^\n/, "").replace(/\s+$/, "");

const IDS = "abcdefgh";
const opts = (...texts: string[]): Option[] => texts.map((text, i) => ({ id: IDS[i]!, text }));
const codeOpts = (...texts: string[]): Option[] => texts.map((text, i) => ({ id: IDS[i]!, text, code: true }));
const pick = (index: number): Answer => ({ kind: "option", optionId: IDS[index]! });
const text = (...accepted: string[]): Answer => ({ kind: "text", accepted });

const cMain = (body: string, top = "") =>
  `#include <stdio.h>\n#include <string.h>\n#include <stdlib.h>\n${top}\nint main(void) {\n${body}\nreturn 0;\n}\n`;
const javaMain = (body: string, classes = "") =>
  `public class Main {\npublic static void main(String[] args) {\n${body}\n}\n}\n${classes}\n`;

interface Base {
  id: string;
  skillId: string;
  difficulty: Difficulty;
  language: Language;
  stem: string;
  explanation: string;
  hints?: string[];
  tags?: string[];
  verify?: Verify;
}

function q(type: QuestionType, base: Base, body: Omit<Question["body"], "stem" | "language">, answer: Answer): SeedQuestion {
  return {
    id: base.id,
    type,
    skillId: base.skillId,
    difficulty: base.difficulty,
    body: { stem: base.stem, language: base.language, ...body },
    answer,
    explanation: base.explanation,
    hints: base.hints ?? [],
    tags: base.tags,
    verify: base.verify,
  };
}

const parsonsLines = (...lines: string[]): ParsonsLine[] =>
  lines.map((t, i) => ({ id: t.startsWith("~") ? `d${i}` : `l${i + 1}`, text: t.replace(/^~/, "") }));

export const QUESTIONS: SeedQuestion[] = [
  // ---------------- Basics ----------------
  q("predict_output", {
    id: "py-basics-ops-1", skillId: "basics.operators", difficulty: 1, language: "python",
    stem: "What does this print?",
    explanation: "// is floor division (3), % is the remainder (1) and / is true division (3.5).",
    hints: ["Python has two division operators: / and //."],
    verify: { runner: "python" },
  }, { code: code`print(7 // 2, 7 % 2, 7 / 2)`, options: opts("3 1 3.5", "3.5 1 3", "3 1 3", "4 1 3.5") }, pick(0)),

  q("predict_output", {
    id: "c-basics-ops-1", skillId: "basics.operators", difficulty: 2, language: "c",
    stem: "What does this print?",
    explanation: "a / b is integer division (3); the cast makes the last division floating point (3.33).",
    hints: ["Both a and b are int. What type is a / b?"],
    verify: { runner: "c", program: cMain(`int a = 10, b = 3;\nprintf("%d %d %.2f", a / b, a % b, (float)a / b);`) },
  }, { code: code`
int a = 10, b = 3;
printf("%d %d %.2f", a / b, a % b, (float)a / b);`, options: opts("3 1 3.33", "3.33 1 3.33", "3 1 3.00", "3 0 3.33") }, pick(0)),

  q("predict_output", {
    id: "java-basics-io-1", skillId: "basics.io", difficulty: 1, language: "java",
    stem: "What does this print?",
    explanation: "Evaluation is left to right: 1 + 2 = 3, then \"3\" makes it a String, so 4 and 5 are appended as text: 3345.",
    hints: ["+ is evaluated left to right; once a String appears, + means concatenation."],
    verify: { runner: "java", program: javaMain(`System.out.println(1 + 2 + "3" + 4 + 5);`) },
  }, { code: code`System.out.println(1 + 2 + "3" + 4 + 5);`, options: opts("12345", "3345", "339", "3312") }, pick(1)),

  q("predict_output", {
    id: "py-basics-io-1", skillId: "basics.io", difficulty: 1, language: "python",
    stem: "What does this print?",
    explanation: "sep goes between the arguments and end replaces the default newline.",
    verify: { runner: "python" },
  }, { code: code`print("a", "b", sep="-", end="!")`, options: opts("a-b!", "a b!", "a-b-!", "a!-b") }, pick(0)),

  q("pseudocode_mcq", {
    id: "pseudo-basics-1", skillId: "pseudocode.basics", difficulty: 1, language: "pseudocode",
    stem: "What will be the output of the following pseudocode?",
    explanation: "a = 11, then b = 11 - 7 = 4, then a = 11 - 4 = 7. The values are swapped without a temporary variable.",
    hints: ["Track a and b after every line."],
    tags: ["service_pseudocode"],
    verify: { runner: "python", program: "a, b = 4, 7\na = a + b\nb = a - b\na = a - b\nprint(a, b)" },
  }, { code: code`
Integer a = 4, b = 7
a = a + b
b = a - b
a = a - b
Print a, b`, options: opts("7 4", "4 7", "11 4", "7 11") }, pick(0)),

  q("pseudocode_mcq", {
    id: "pseudo-basics-2", skillId: "pseudocode.basics", difficulty: 2, language: "pseudocode",
    stem: "What will be the output of the following pseudocode?",
    explanation: "i=1: x=-1, i=2: x=1, i=3: x=0, i=4: x=4, i=5: x=3.",
    hints: ["Only even values of i are added."],
    tags: ["service_pseudocode"],
    verify: {
      runner: "python",
      program: "x = 0\nfor i in range(1, 6):\n    if i % 2 == 0:\n        x = x + i\n    else:\n        x = x - 1\nprint(x)",
    },
  }, { code: code`
Integer x = 0
for (i = 1 to 5)
    if (i mod 2 == 0)
        x = x + i
    else
        x = x - 1
    end if
end for
Print x`, options: opts("3", "6", "5", "-3") }, pick(0)),

  q("pseudocode_mcq", {
    id: "pseudo-basics-3", skillId: "pseudocode.basics", difficulty: 2, language: "pseudocode",
    stem: "What will be the output of the following pseudocode? (/ is integer division)",
    explanation: "The loop adds the last digit each time and drops it: 5 + 4 + 3 + 2 + 1 = 15.",
    tags: ["service_pseudocode"],
    verify: { runner: "python", program: "n, s = 12345, 0\nwhile n > 0:\n    s = s + n % 10\n    n = n // 10\nprint(s)" },
  }, { code: code`
Integer n = 12345, s = 0
while (n > 0)
    s = s + (n mod 10)
    n = n / 10
end while
Print s`, options: opts("15", "12345", "54321", "5") }, pick(0)),

  q("pseudocode_mcq", {
    id: "pseudo-basics-4", skillId: "pseudocode.basics", difficulty: 3, language: "pseudocode",
    stem: "What will be the output of the following pseudocode?",
    explanation: "After each pass (a, b) becomes (1,2), (2,3), (3,5), (5,8). This is the Fibonacci sequence.",
    tags: ["service_pseudocode"],
    verify: { runner: "python", program: "a, b = 1, 1\nfor i in range(1, 5):\n    t = a + b\n    a = b\n    b = t\nprint(b)" },
  }, { code: code`
Integer a = 1, b = 1
for (i = 1 to 4)
    Integer t = a + b
    a = b
    b = t
end for
Print b`, options: opts("8", "5", "13", "4") }, pick(0)),

  q("pseudocode_mcq", {
    id: "pseudo-basics-5", skillId: "pseudocode.basics", difficulty: 2, language: "pseudocode",
    stem: "What will be the output? (& is bitwise AND, | is bitwise OR)",
    explanation: "5 is 101 and 3 is 011. AND gives 001 (1), OR gives 111 (7). 1 + 7 = 8.",
    hints: ["Write 5 and 3 in binary."],
    tags: ["service_pseudocode"],
    verify: { runner: "python", program: "print((5 & 3) + (5 | 3))" },
  }, { code: code`Print (5 & 3) + (5 | 3)`, options: opts("8", "7", "15", "6") }, pick(0)),

  // ---------------- Conditionals ----------------
  q("predict_output", {
    id: "py-cond-1", skillId: "conditionals.if", difficulty: 1, language: "python",
    stem: "What does this print?",
    explanation: "The two if statements are independent: x > 10 prints A, and x > 5 prints B.",
    verify: { runner: "python" },
  }, { code: code`
x = 15
if x > 10:
    print("A", end="")
if x > 5:
    print("B", end="")
else:
    print("C", end="")`, options: opts("A", "AB", "ABC", "B") }, pick(1)),

  q("predict_output", {
    id: "c-cond-1", skillId: "conditionals.if", difficulty: 2, language: "c",
    stem: "What does this print?",
    explanation: "x = 5 is an assignment, not a comparison. Its value is 5, which is true, so \"yes\" prints.",
    hints: ["Look closely at the condition: = or ==?"],
    verify: { runner: "c", program: cMain(`int x = 0;\nif (x = 5) printf("yes"); else printf("no");`) },
  }, { code: code`
int x = 0;
if (x = 5) printf("yes");
else printf("no");`, options: opts("yes", "no", "Compilation error", "5") }, pick(0)),

  q("spot_bug", {
    id: "py-cond-bug-1", skillId: "conditionals.if", difficulty: 1, language: "python",
    stem: "Tap the line with the bug.",
    explanation: "Line 2 uses = (assignment) where it needs == (comparison); Python rejects it as a syntax error.",
  }, { code: code`
def is_even(n):
    if n % 2 = 0:
        return True
    return False` }, { kind: "lines", lines: [2] }),

  // ---------------- Loops ----------------
  q("trace_variable", {
    id: "py-for-trace-1", skillId: "loops.for", difficulty: 1, language: "python",
    stem: "What is the value of total after the loop?",
    explanation: "range(1, 5) is 1, 2, 3, 4, so total = 1 + 4 + 9 + 16 = 30.",
    hints: ["range(1, 5) stops before 5."],
    verify: { runner: "python", harness: "print(total)" },
  }, { code: code`
total = 0
for i in range(1, 5):
    total += i * i`, inputHint: "total = ?" }, text("30")),

  q("predict_output", {
    id: "c-for-1", skillId: "loops.for", difficulty: 1, language: "c",
    stem: "What does this print?",
    explanation: "i takes 0, 3, 6, 9; the next value 12 fails i < 10.",
    verify: { runner: "c", program: cMain(`for (int i = 0; i < 10; i += 3) printf("%d ", i);`) },
  }, { code: code`for (int i = 0; i < 10; i += 3) printf("%d ", i);`, options: opts("0 3 6 9", "0 3 6 9 12", "3 6 9", "0 3 6") }, pick(0)),

  q("parsons", {
    id: "py-for-parsons-1", skillId: "loops.for", difficulty: 2, language: "python",
    stem: "Arrange the lines so count_even returns how many numbers in xs are even. One line is not needed.",
    explanation: "The counter starts at 0, increases inside the if, and is returned after the loop finishes.",
    hints: ["The return must not be inside the loop."],
    verify: { runner: "python", harness: "print(count_even([1, 2, 3, 4, 6]))", expected: "3" },
  }, {
    lines: parsonsLines(
      "def count_even(xs):",
      "    c = 0",
      "    for x in xs:",
      "        if x % 2 == 0:",
      "            c += 1",
      "    return c",
      "~        return c",
    ),
  }, { kind: "order", orders: [["l1", "l2", "l3", "l4", "l5", "l6"]] }),

  q("predict_output", {
    id: "py-while-1", skillId: "loops.while", difficulty: 2, language: "python",
    stem: "What does this print?",
    explanation: "10 → 5 → 16 → 8 → 4 → 2 → 1 takes 6 steps.",
    hints: ["Write down n after every step."],
    verify: { runner: "python" },
  }, { code: code`
n = 10
count = 0
while n != 1:
    n = n // 2 if n % 2 == 0 else 3 * n + 1
    count += 1
print(count)`, options: opts("6", "7", "5", "10") }, pick(0)),

  q("fill_blank", {
    id: "java-while-fill-1", skillId: "loops.while", difficulty: 2, language: "java",
    stem: "Fill in the blank so the loop reverses the digits of n (1234 becomes 4321).",
    explanation: "n % 10 is the last digit; it is appended to rev before n drops that digit.",
  }, { code: code`
int n = 1234, rev = 0;
while (n > 0) {
    rev = rev * 10 + ____;
    n = n / 10;
}`, options: opts("n % 10", "n / 10", "rev % 10", "n * 10") }, pick(0)),

  q("trace_variable", {
    id: "c-while-trace-1", skillId: "loops.while", difficulty: 2, language: "c",
    stem: "What is the value of s after the loop?",
    explanation: "i takes 0, 2, 4, so s = 0 + 2 + 4 = 6.",
    verify: { runner: "c", program: cMain(`int i = 0, s = 0;\nwhile (i < 5) { s += i; i += 2; }\nprintf("%d", s);`) },
  }, { code: code`
int i = 0, s = 0;
while (i < 5) {
    s += i;
    i += 2;
}`, inputHint: "s = ?" }, text("6")),

  q("predict_output", {
    id: "c-nested-1", skillId: "loops.nested", difficulty: 2, language: "c",
    stem: "How many stars does this print?",
    explanation: "The inner loop runs 3, 2 and 1 times for i = 0, 1, 2: 6 stars.",
    hints: ["Count inner iterations for each value of i."],
    verify: { runner: "c", program: cMain(`int i, j;\nfor (i = 0; i < 3; i++)\n  for (j = i; j < 3; j++)\n    printf("*");`) },
  }, { code: code`
int i, j;
for (i = 0; i < 3; i++)
    for (j = i; j < 3; j++)
        printf("*");`, options: opts("***", "******", "*********", "****") }, pick(1)),

  q("predict_output", {
    id: "py-nested-1", skillId: "loops.nested", difficulty: 3, language: "python",
    stem: "What does this print?",
    explanation: "break only leaves the inner loop. Each i prints its j = 0 value, then breaks at j = 1: 10 20 30.",
    hints: ["Which loop does break exit?"],
    verify: { runner: "python" },
  }, { code: code`
for i in range(1, 4):
    for j in range(i):
        if j == 1:
            break
        print(i * 10 + j, end=" ")`, options: opts("10 20 30", "10 20 21 30 31 32", "10 20 30 31", "10 21 32") }, pick(0)),

  // ---------------- Arrays ----------------
  q("predict_output", {
    id: "py-arr-1", skillId: "arrays.basics", difficulty: 1, language: "python",
    stem: "What does this print?",
    explanation: "a[1:4] takes indexes 1 to 3; a[-1] is the last element.",
    verify: { runner: "python" },
  }, { code: code`
a = [1, 2, 3, 4, 5]
print(a[1:4], a[-1])`, options: opts("[2, 3, 4] 5", "[1, 2, 3, 4] 5", "[2, 3, 4, 5] 1", "[2, 3] 4") }, pick(0)),

  q("predict_output", {
    id: "c-arr-1", skillId: "arrays.basics", difficulty: 2, language: "c",
    stem: "What does this print?",
    explanation: "When an array has an initialiser, elements without a value are set to 0.",
    verify: { runner: "c", program: cMain(`int a[5] = {1, 2, 3};\nprintf("%d %d", a[2], a[4]);`) },
  }, { code: code`
int a[5] = {1, 2, 3};
printf("%d %d", a[2], a[4]);`, options: opts("3 0", "3 (garbage value)", "2 0", "3 3") }, pick(0)),

  q("spot_bug", {
    id: "java-arr-bug-1", skillId: "arrays.basics", difficulty: 2, language: "java",
    stem: "This should print the average mark. Tap the line with the bug.",
    explanation: "i <= marks.length reads one past the end and throws ArrayIndexOutOfBoundsException; use i < marks.length.",
    hints: ["What is the last valid index?"],
  }, { code: code`
int[] marks = {70, 85, 90};
int sum = 0;
for (int i = 0; i <= marks.length; i++) {
    sum += marks[i];
}
System.out.println(sum / marks.length);` }, { kind: "lines", lines: [3] }),

  q("parsons", {
    id: "py-search-parsons-1", skillId: "arrays.search", difficulty: 2, language: "python",
    stem: "Arrange the lines so find returns the index of target in xs, or -1 if it is missing. One line is not needed.",
    explanation: "Return as soon as a match is found; only after checking every element do we return -1.",
    hints: ["return -1 belongs after the loop, not inside it."],
    verify: { runner: "python", harness: "print(find([4, 7, 9], 9), find([4, 7, 9], 5))", expected: "2 -1" },
  }, {
    lines: parsonsLines(
      "def find(xs, target):",
      "    for i in range(len(xs)):",
      "        if xs[i] == target:",
      "            return i",
      "    return -1",
      "~        return -1",
    ),
  }, { kind: "order", orders: [["l1", "l2", "l3", "l4", "l5"]] }),

  q("which_snippet", {
    id: "py-search-which-1", skillId: "arrays.search", difficulty: 2, language: "python",
    stem: "Which snippet returns the largest value in a non-empty list xs, including lists of negative numbers?",
    explanation: "Starting from xs[0] works for any values. Starting from 0 fails when every value is negative.",
  }, {
    options: codeOpts(
      "m = xs[0]\nfor x in xs:\n    if x > m: m = x\nreturn m",
      "m = 0\nfor x in xs:\n    if x > m: m = x\nreturn m",
      "m = xs[0]\nfor x in xs:\n    if x < m: m = x\nreturn m",
      "return xs[len(xs) - 1]",
    ),
  }, pick(0)),

  // ---------------- Strings ----------------
  q("predict_output", {
    id: "py-str-1", skillId: "strings.basics", difficulty: 1, language: "python",
    stem: "What does this print?",
    explanation: "s[::-1] reverses the string (tnemecalp); [:3] takes the first three characters.",
    verify: { runner: "python" },
  }, { code: code`
s = "placement"
print(s[::-1][:3])`, options: opts("tne", "pla", "ent", "nem") }, pick(0)),

  q("predict_output", {
    id: "java-str-1", skillId: "strings.basics", difficulty: 2, language: "java",
    stem: "What does this print?",
    explanation: "Strings are immutable. concat returns a new String that is thrown away, so s is still \"Hello\".",
    hints: ["Is the result of concat stored anywhere?"],
    verify: { runner: "java", program: javaMain(`String s = "Hello";\ns.concat(" World");\nSystem.out.println(s.length());`) },
  }, { code: code`
String s = "Hello";
s.concat(" World");
System.out.println(s.length());`, options: opts("5", "11", "10", "6") }, pick(0)),

  q("predict_output", {
    id: "c-str-1", skillId: "strings.basics", difficulty: 2, language: "c",
    stem: "What does this print?",
    explanation: "sizeof counts the terminating '\\0' (4 bytes); strlen counts characters before it (3).",
    verify: { runner: "c", program: cMain(`char s[] = "abc";\nprintf("%zu %zu", sizeof(s), strlen(s));`) },
  }, { code: code`
char s[] = "abc";
printf("%zu %zu", sizeof(s), strlen(s));`, options: opts("4 3", "3 3", "3 4", "4 4") }, pick(0)),

  q("fill_blank", {
    id: "py-str-fill-1", skillId: "strings.basics", difficulty: 1, language: "python",
    stem: "Type the missing keyword so count is the number of vowels in s.",
    explanation: "ch in \"aeiou\" checks membership in the string of vowels.",
  }, { code: code`count = sum(1 for ch in s if ch ____ "aeiou")`, inputHint: "keyword" }, text("in")),

  q("trace_variable", {
    id: "java-str-trace-1", skillId: "strings.basics", difficulty: 2, language: "java",
    stem: "What is the value of count after the loop?",
    explanation: "\"banana\" has three 'a' characters.",
    verify: {
      runner: "java",
      program: javaMain(`String s = "banana";\nint count = 0;\nfor (int i = 0; i < s.length(); i++)\n  if (s.charAt(i) == 'a') count++;\nSystem.out.println(count);`),
    },
  }, { code: code`
String s = "banana";
int count = 0;
for (int i = 0; i < s.length(); i++)
    if (s.charAt(i) == 'a') count++;`, inputHint: "count = ?" }, text("3")),

  // ---------------- Functions ----------------
  q("predict_output", {
    id: "py-fn-1", skillId: "functions.basics", difficulty: 3, language: "python",
    stem: "What does this print?",
    explanation: "The default list is created once, when the function is defined, so both calls append to the same list.",
    hints: ["When is the default value bag=[] created?"],
    verify: { runner: "python" },
  }, { code: code`
def add(item, bag=[]):
    bag.append(item)
    return bag

add(1)
print(add(2))`, options: opts("[2]", "[1, 2]", "[1]", "TypeError") }, pick(1)),

  q("predict_output", {
    id: "c-fn-1", skillId: "functions.scope", difficulty: 1, language: "c",
    stem: "What does this print?",
    explanation: "C passes arguments by value: change gets a copy of a, so a stays 10.",
    verify: { runner: "c", program: cMain(`int a = 10;\nchange(a);\nprintf("%d", a);`, "void change(int x) { x = 20; }") },
  }, { code: code`
void change(int x) { x = 20; }

int main(void) {
    int a = 10;
    change(a);
    printf("%d", a);
}`, options: opts("10", "20", "0", "Garbage value") }, pick(0)),

  q("predict_output", {
    id: "py-scope-1", skillId: "functions.scope", difficulty: 2, language: "python",
    stem: "What does this print?",
    explanation: "Assigning x inside f creates a new local x; the global x is unchanged.",
    verify: { runner: "python" },
  }, { code: code`
x = 5
def f():
    x = 10
    return x
print(f(), x)`, options: opts("10 5", "10 10", "5 5", "5 10") }, pick(0)),

  q("parsons", {
    id: "py-fn-parsons-1", skillId: "functions.basics", difficulty: 1, language: "python",
    stem: "Arrange the lines so total returns the sum of the list. One line is not needed.",
    explanation: "Initialise the sum, add each element, and return after the loop.",
    verify: { runner: "python", harness: "print(total([1, 2, 3]))", expected: "6" },
  }, {
    lines: parsonsLines("def total(xs):", "    s = 0", "    for x in xs:", "        s += x", "    return s", "~    return 0"),
  }, { kind: "order", orders: [["l1", "l2", "l3", "l4", "l5"]] }),

  // ---------------- Recursion ----------------
  q("predict_output", {
    id: "py-rec-1", skillId: "recursion.basics", difficulty: 2, language: "python",
    stem: "What does this print?",
    explanation: "f(7) = 7 × f(5) = 7 × 5 × f(3) = 7 × 5 × 3 × f(1) = 105.",
    hints: ["n goes down by 2 each call."],
    verify: { runner: "python" },
  }, { code: code`
def f(n):
    if n <= 1:
        return 1
    return n * f(n - 2)
print(f(7))`, options: opts("105", "5040", "15", "48") }, pick(0)),

  q("predict_output", {
    id: "c-rec-1", skillId: "recursion.basics", difficulty: 3, language: "c",
    stem: "Type the exact output.",
    explanation: "f adds the digits: 4 + 0 + 9 + 6 = 19.",
    verify: { runner: "c", program: cMain(`printf("%d", f(4096));`, "int f(int n) { if (n == 0) return 0; return n % 10 + f(n / 10); }") },
  }, { code: code`
int f(int n) {
    if (n == 0) return 0;
    return n % 10 + f(n / 10);
}
/* in main: */ printf("%d", f(4096));`, inputHint: "output" }, text("19")),

  q("spot_bug", {
    id: "py-rec-bug-1", skillId: "recursion.basics", difficulty: 2, language: "python",
    stem: "factorial(5) should be 120 but returns 0. Tap the line with the bug.",
    explanation: "The base case must return 1; returning 0 makes every product 0.",
  }, { code: code`
def factorial(n):
    if n == 0:
        return 0
    return n * factorial(n - 1)` }, { kind: "lines", lines: [3] }),

  q("reverse_mode", {
    id: "py-rec-reverse-1", skillId: "recursion.basics", difficulty: 2, language: "python",
    stem: "Which function produces these outputs?",
    explanation: "Each value is the sum of the previous two, with f(1) = f(2) = 1: the Fibonacci numbers.",
  }, {
    examples: [
      { input: "f(1)", output: "1" },
      { input: "f(2)", output: "1" },
      { input: "f(3)", output: "2" },
      { input: "f(4)", output: "3" },
      { input: "f(5)", output: "5" },
    ],
    options: codeOpts(
      "def f(n):\n    return 1 if n <= 2 else f(n - 1) + f(n - 2)",
      "def f(n):\n    return n if n <= 1 else f(n - 1) * 2",
      "def f(n):\n    return 1 if n == 1 else f(n - 1) + n",
      "def f(n):\n    return n - 1 if n > 1 else 1",
    ),
  }, pick(0)),

  // ---------------- Pointers ----------------
  q("predict_output", {
    id: "c-ptr-1", skillId: "pointers.basics", difficulty: 1, language: "c",
    stem: "What does this print?",
    explanation: "p points to a, so *p = *p + 5 changes a itself to 15.",
    verify: { runner: "c", program: cMain(`int a = 10;\nint *p = &a;\n*p = *p + 5;\nprintf("%d", a);`) },
  }, { code: code`
int a = 10;
int *p = &a;
*p = *p + 5;
printf("%d", a);`, options: opts("15", "10", "5", "Address of a") }, pick(0)),

  q("predict_output", {
    id: "c-ptr-2", skillId: "pointers.basics", difficulty: 3, language: "c",
    stem: "What does this print?",
    explanation: "p += 2 moves two ints forward to arr[2] (30); *(p - 1) is arr[1] (20).",
    hints: ["Pointer arithmetic moves by whole elements, not bytes."],
    verify: { runner: "c", program: cMain(`int arr[] = {10, 20, 30, 40};\nint *p = arr;\np += 2;\nprintf("%d %d", *p, *(p - 1));`) },
  }, { code: code`
int arr[] = {10, 20, 30, 40};
int *p = arr;
p += 2;
printf("%d %d", *p, *(p - 1));`, options: opts("30 20", "12 11", "20 10", "30 29") }, pick(0)),

  q("spot_bug", {
    id: "c-ptr-bug-1", skillId: "pointers.basics", difficulty: 3, language: "c",
    stem: "This should return a copy of s. Tap the line with the bug.",
    explanation: "malloc(strlen(s)) leaves no room for the terminating '\\0'; it must be strlen(s) + 1.",
    hints: ["How many bytes does \"abc\" need?"],
  }, { code: code`
char *copy(const char *s) {
    char *out = malloc(strlen(s));
    strcpy(out, s);
    return out;
}` }, { kind: "lines", lines: [2] }),

  // ---------------- OOP ----------------
  q("predict_output", {
    id: "java-oop-1", skillId: "oop.classes", difficulty: 2, language: "java",
    stem: "What does this print?",
    explanation: "count is static, so all objects share it. Three constructor calls make it 3.",
    verify: {
      runner: "java",
      program: javaMain(`new Counter(); new Counter(); new Counter();\nSystem.out.println(Counter.count);`, "class Counter { static int count = 0; Counter() { count++; } }"),
    },
  }, { code: code`
class Counter {
    static int count = 0;
    Counter() { count++; }
}
// in main:
new Counter(); new Counter(); new Counter();
System.out.println(Counter.count);`, options: opts("3", "1", "0", "Compilation error") }, pick(0)),

  q("predict_output", {
    id: "java-oop-2", skillId: "oop.inheritance", difficulty: 2, language: "java",
    stem: "What does this print?",
    explanation: "The object is a B, so B.show runs (dynamic dispatch). It prints B, then super.show() prints A.",
    verify: {
      runner: "java",
      program: javaMain(`A obj = new B();\nobj.show();`, `class A { void show() { System.out.print("A"); } }\nclass B extends A { void show() { System.out.print("B"); super.show(); } }`),
    },
  }, { code: code`
class A { void show() { System.out.print("A"); } }
class B extends A {
    void show() { System.out.print("B"); super.show(); }
}
// in main:
A obj = new B();
obj.show();`, options: opts("BA", "A", "B", "AB") }, pick(0)),

  q("predict_output", {
    id: "java-oop-3", skillId: "oop.inheritance", difficulty: 2, language: "java",
    stem: "What does this print?",
    explanation: "A subclass constructor first calls the parent constructor, so P prints before C.",
    verify: {
      runner: "java",
      program: javaMain(`new C();`, `class P { P() { System.out.print("P"); } }\nclass C extends P { C() { System.out.print("C"); } }`),
    },
  }, { code: code`
class P { P() { System.out.print("P"); } }
class C extends P { C() { System.out.print("C"); } }
// in main:
new C();`, options: opts("PC", "CP", "C", "P") }, pick(0)),

  q("fill_blank", {
    id: "py-oop-fill-1", skillId: "oop.classes", difficulty: 1, language: "python",
    stem: "Type the missing first parameter of the constructor.",
    explanation: "Instance methods receive the object as their first parameter, named self by convention.",
  }, { code: code`
class Student:
    def __init__(____, name):
        self.name = name`, inputHint: "parameter name" }, text("self")),

  // ---------------- Complexity ----------------
  q("complexity", {
    id: "cx-1", skillId: "complexity.bigo", difficulty: 1, language: "python",
    stem: "What is the time complexity?",
    explanation: "Two nested loops over n each run n × n times.",
    tags: ["product_dsa"],
  }, { code: code`
for i in range(n):
    for j in range(n):
        total += i * j`, options: opts("O(n)", "O(n log n)", "O(n²)", "O(2ⁿ)") }, pick(2)),

  q("complexity", {
    id: "cx-2", skillId: "complexity.bigo", difficulty: 2, language: "python",
    stem: "What is the time complexity?",
    explanation: "i doubles each time, so the loop runs about log₂ n times.",
    tags: ["product_dsa"],
  }, { code: code`
i = 1
while i < n:
    i *= 2`, options: opts("O(1)", "O(log n)", "O(n)", "O(n log n)") }, pick(1)),

  q("complexity", {
    id: "cx-3", skillId: "complexity.bigo", difficulty: 2, language: "pseudocode",
    stem: "What is the worst-case time complexity of binary search on a sorted array of n elements?",
    explanation: "Each step halves the search range, so it takes at most about log₂ n steps.",
    tags: ["product_dsa"],
  }, { options: opts("O(1)", "O(log n)", "O(n)", "O(n log n)") }, pick(1)),

  q("complexity", {
    id: "cx-4", skillId: "complexity.bigo", difficulty: 3, language: "python",
    stem: "What is the time complexity?",
    explanation: "The outer loop runs n times and the inner doubling loop runs log n times each: O(n log n).",
    tags: ["product_dsa"],
  }, { code: code`
for i in range(n):
    j = 1
    while j < n:
        j *= 2`, options: opts("O(n)", "O(log n)", "O(n log n)", "O(n²)") }, pick(2)),

  q("complexity", {
    id: "cx-5", skillId: "complexity.bigo", difficulty: 3, language: "python",
    stem: "What is the time complexity of this naive Fibonacci?",
    explanation: "Each call makes two more calls, so the call tree grows exponentially (bounded by O(2ⁿ)).",
    tags: ["product_dsa"],
  }, { code: code`
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)`, options: opts("O(n)", "O(n log n)", "O(n²)", "O(2ⁿ)") }, pick(3)),
];
