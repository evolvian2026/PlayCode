import type { CodeLanguage, Difficulty, TestCase } from "@playcode/core";
import type { SeedQuestion } from "./questions";

// Coding problems read stdin and write stdout, HackerRank style, so one set of
// tests works in every language. Each problem carries a reference solution per
// language; `pnpm verify:content` runs all of them against every test.

const code = (s: TemplateStringsArray, ...v: unknown[]) => String.raw(s, ...v).replace(/^\n/, "").replace(/\s+$/, "");

const STARTER: Record<CodeLanguage, string> = {
  python: code`
# Read input with input(), print the answer.
`,
  c: code`
#include <stdio.h>

int main(void) {
    // Read input with scanf, print the answer with printf.
    return 0;
}
`,
  java: code`
import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        // Read input, print the answer.
    }
}
`,
};

interface Problem {
  id: string;
  difficulty: Difficulty;
  stem: string;
  explanation: string;
  hints: string[];
  tests: TestCase[];
  solutions: Record<CodeLanguage, string>;
  tags?: string[];
}

function problem(p: Problem): SeedQuestion {
  return {
    id: p.id,
    type: "write_code",
    skillId: "coding.basics",
    difficulty: p.difficulty,
    body: { stem: p.stem, language: "python", languages: ["python", "c", "java"], starterCode: STARTER },
    answer: { kind: "tests", tests: p.tests, reference: { language: "python", source: p.solutions.python } },
    explanation: p.explanation,
    hints: p.hints,
    tags: p.tags,
    solutions: p.solutions,
  };
}

const t = (input: string, output: string, hidden = true): TestCase => ({ input, output, hidden });

export const CODING_QUESTIONS: SeedQuestion[] = [
  problem({
    id: "code-sum-two",
    difficulty: 1,
    stem: "Read two integers a and b on one line and print their sum.",
    explanation: "Read both numbers, add them, print the result. Use a 64-bit type in C/Java if values can be large.",
    hints: ["In Python: a, b = map(int, input().split())"],
    tests: [t("3 5", "8", false), t("-4 10", "6", false), t("0 0", "0"), t("1000000000 1000000000", "2000000000")],
    solutions: {
      python: "a, b = map(int, input().split())\nprint(a + b)",
      c: '#include <stdio.h>\nint main(void) {\n    long long a, b;\n    scanf("%lld %lld", &a, &b);\n    printf("%lld\\n", a + b);\n    return 0;\n}',
      java: "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        long a = in.nextLong(), b = in.nextLong();\n        System.out.println(a + b);\n    }\n}",
    },
  }),
  problem({
    id: "code-even-odd",
    difficulty: 1,
    stem: "The first line has n. The second line has n integers. Print how many are even and how many are odd, separated by a space.",
    explanation: "Loop over the numbers and count those with x % 2 == 0. Negative odd numbers give -1 in C and Java, so test == 0, not == 1.",
    hints: ["Count evens; odds are n minus evens."],
    tests: [t("5\n1 2 3 4 6", "3 2", false), t("3\n7 9 11", "0 3", false), t("4\n-2 -3 0 5", "2 2"), t("1\n8", "1 0")],
    solutions: {
      python: "n = int(input())\nxs = list(map(int, input().split()))\neven = sum(1 for x in xs if x % 2 == 0)\nprint(even, n - even)",
      c: '#include <stdio.h>\nint main(void) {\n    int n, x, even = 0;\n    scanf("%d", &n);\n    for (int i = 0; i < n; i++) { scanf("%d", &x); if (x % 2 == 0) even++; }\n    printf("%d %d\\n", even, n - even);\n    return 0;\n}',
      java: "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        int n = in.nextInt(), even = 0;\n        for (int i = 0; i < n; i++) if (in.nextInt() % 2 == 0) even++;\n        System.out.println(even + \" \" + (n - even));\n    }\n}",
    },
  }),
  problem({
    id: "code-reverse-words",
    difficulty: 2,
    stem: "Read a line of words separated by single spaces and print the words in reverse order.",
    explanation: "Split on spaces, reverse the list, join with spaces.",
    hints: ["Python: ' '.join(reversed(line.split()))"],
    tests: [t("campus placements are near", "near are placements campus", false), t("hello", "hello", false), t("a b c d e", "e d c b a"), t("one two", "two one")],
    solutions: {
      python: "print(' '.join(reversed(input().split())))",
      c: '#include <stdio.h>\n#include <string.h>\nint main(void) {\n    char line[10001], *words[5000];\n    int n = 0;\n    if (!fgets(line, sizeof line, stdin)) return 0;\n    line[strcspn(line, "\\r\\n")] = 0;\n    for (char *w = strtok(line, " "); w; w = strtok(NULL, " ")) words[n++] = w;\n    for (int i = n - 1; i >= 0; i--) printf("%s%s", words[i], i ? " " : "\\n");\n    return 0;\n}',
      java: "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        List<String> w = new ArrayList<>(Arrays.asList(in.nextLine().trim().split(\" \")));\n        Collections.reverse(w);\n        System.out.println(String.join(\" \", w));\n    }\n}",
    },
  }),
  problem({
    id: "code-second-largest",
    difficulty: 2,
    stem: "The first line has n. The second line has n integers. Print the second largest distinct value, or -1 if there is none.",
    explanation: "Track the largest and the second largest distinct values in one pass, or sort the distinct values.",
    hints: ["Duplicates of the maximum do not count as the second largest."],
    tests: [t("5\n4 9 9 2 7", "7", false), t("3\n5 5 5", "-1", false), t("1\n10", "-1"), t("4\n-1 -5 -3 -1", "-3"), t("6\n1 2 3 4 5 6", "5")],
    tags: ["product_dsa"],
    solutions: {
      python: "n = int(input())\nxs = sorted(set(map(int, input().split())))\nprint(xs[-2] if len(xs) > 1 else -1)",
      c: '#include <stdio.h>\n#include <limits.h>\nint main(void) {\n    int n; long long x, a = LLONG_MIN, b = LLONG_MIN;\n    scanf("%d", &n);\n    for (int i = 0; i < n; i++) {\n        scanf("%lld", &x);\n        if (x > a) { b = a; a = x; } else if (x < a && x > b) b = x;\n    }\n    printf("%lld\\n", b == LLONG_MIN ? -1 : b);\n    return 0;\n}',
      java: "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        int n = in.nextInt();\n        TreeSet<Long> s = new TreeSet<>();\n        for (int i = 0; i < n; i++) s.add(in.nextLong());\n        s.pollLast();\n        System.out.println(s.isEmpty() ? -1 : s.last());\n    }\n}",
    },
  }),
  problem({
    id: "code-palindrome",
    difficulty: 1,
    stem: "Read a word and print YES if it reads the same forwards and backwards, ignoring upper and lower case. Otherwise print NO.",
    explanation: "Lower-case the word and compare it with its reverse.",
    hints: ["Compare characters from both ends moving inwards."],
    tests: [t("Madam", "YES", false), t("code", "NO", false), t("a", "YES"), t("Racecar", "YES"), t("ab", "NO")],
    solutions: {
      python: "s = input().strip().lower()\nprint('YES' if s == s[::-1] else 'NO')",
      c: '#include <stdio.h>\n#include <string.h>\n#include <ctype.h>\nint main(void) {\n    char s[1001];\n    scanf("%1000s", s);\n    int n = strlen(s), ok = 1;\n    for (int i = 0; i < n / 2; i++) if (tolower(s[i]) != tolower(s[n - 1 - i])) ok = 0;\n    puts(ok ? "YES" : "NO");\n    return 0;\n}',
      java: "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        String s = new Scanner(System.in).next().toLowerCase();\n        System.out.println(new StringBuilder(s).reverse().toString().equals(s) ? \"YES\" : \"NO\");\n    }\n}",
    },
  }),
  problem({
    id: "code-primes",
    difficulty: 2,
    stem: "Read n and print every prime number from 2 to n, separated by spaces. Print nothing if there are none.",
    explanation: "Check each number for divisors up to its square root, or use the Sieve of Eratosthenes for speed.",
    hints: ["A number is prime if no d with d * d <= n divides it."],
    tests: [t("10", "2 3 5 7", false), t("2", "2", false), t("1", ""), t("30", "2 3 5 7 11 13 17 19 23 29")],
    tags: ["service_coding"],
    solutions: {
      python: "n = int(input())\nprint(' '.join(str(x) for x in range(2, n + 1) if all(x % d for d in range(2, int(x ** 0.5) + 1))))",
      c: '#include <stdio.h>\nint main(void) {\n    int n, first = 1;\n    scanf("%d", &n);\n    for (int x = 2; x <= n; x++) {\n        int p = 1;\n        for (int d = 2; d * d <= x; d++) if (x % d == 0) { p = 0; break; }\n        if (p) { printf(first ? "%d" : " %d", x); first = 0; }\n    }\n    printf("\\n");\n    return 0;\n}',
      java: "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        int n = new Scanner(System.in).nextInt();\n        StringJoiner out = new StringJoiner(\" \");\n        for (int x = 2; x <= n; x++) {\n            boolean p = true;\n            for (int d = 2; d * d <= x; d++) if (x % d == 0) { p = false; break; }\n            if (p) out.add(String.valueOf(x));\n        }\n        System.out.println(out);\n    }\n}",
    },
  }),
];

// ---------------- SQL ----------------

const SCHEMA = code`
CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, branch TEXT, cgpa REAL);
CREATE TABLE placements (student_id INTEGER, company TEXT, ctc_lpa REAL);
INSERT INTO students VALUES
  (1, 'Asha', 'CSE', 8.9), (2, 'Bharat', 'ECE', 7.4), (3, 'Chitra', 'CSE', 7.9),
  (4, 'Dev', 'MECH', 6.8), (5, 'Esha', 'CSE', 9.2), (6, 'Farhan', 'ECE', 8.1), (7, 'Gita', 'IT', 8.4);
INSERT INTO placements VALUES
  (1, 'Infosys', 6.5), (5, 'Google', 32.0), (6, 'TCS', 7.0), (7, 'Infosys', 6.5), (3, 'Wipro', 5.5), (5, 'TCS', 7.0);
`;

function sql(id: string, difficulty: Difficulty, stem: string, solution: string, explanation: string, hints: string[], ordered = false): SeedQuestion {
  return {
    id,
    type: "sql_query",
    skillId: "sql.basics",
    difficulty,
    body: { stem, language: "sql", schema: SCHEMA },
    answer: { kind: "sql", solution, ordered },
    explanation,
    hints,
  };
}

export const SQL_QUESTIONS: SeedQuestion[] = [
  sql(
    "sql-cse-toppers",
    1,
    "List the names of CSE students with a CGPA above 8.",
    "SELECT name FROM students WHERE branch = 'CSE' AND cgpa > 8",
    "Filter on both conditions with AND.",
    ["You need a WHERE clause with two conditions."],
  ),
  sql(
    "sql-branch-count",
    2,
    "For each branch, show the branch and the number of students in it.",
    "SELECT branch, COUNT(*) FROM students GROUP BY branch",
    "GROUP BY branch collapses rows per branch; COUNT(*) counts them.",
    ["Use GROUP BY with an aggregate."],
  ),
  sql(
    "sql-avg-ctc",
    2,
    "Show each company and its average CTC (ctc_lpa), highest average first.",
    "SELECT company, AVG(ctc_lpa) FROM placements GROUP BY company ORDER BY AVG(ctc_lpa) DESC",
    "Group by company, average the CTC, then ORDER BY the average descending.",
    ["ORDER BY can use an aggregate."],
    true,
  ),
  sql(
    "sql-unplaced",
    3,
    "List the names of students who have no placement at all.",
    "SELECT s.name FROM students s LEFT JOIN placements p ON p.student_id = s.id WHERE p.student_id IS NULL",
    "A LEFT JOIN keeps every student; those without a match have NULL placement columns.",
    ["LEFT JOIN placements, then keep rows where the placement is missing."],
  ),
];
