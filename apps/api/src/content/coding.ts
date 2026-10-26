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
  /** Defaults to coding.basics. */
  skillId?: string;
}

function problem(p: Problem): SeedQuestion {
  return {
    id: p.id,
    type: "write_code",
    skillId: p.skillId ?? "coding.basics",
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

// Problems in the patterns placement tests lean on: arrays, strings, hashing,
// two pointers, a stack and a sliding window, plus a few service-test staples.
const DSA = "coding.dsa";

CODING_QUESTIONS.push(
  problem({
    id: "code-fizzbuzz",
    difficulty: 1,
    stem: "Read n. For each number from 1 to n print a line: Fizz if it is a multiple of 3, Buzz if a multiple of 5, FizzBuzz if both, otherwise the number itself.",
    explanation: "Check divisibility by 15 first (both), then 3, then 5; otherwise print the number.",
    hints: ["Test the 'both' case before the single cases."],
    tests: [t("5", "1\n2\nFizz\n4\nBuzz", false), t("3", "1\n2\nFizz", false), t("1", "1"), t("15", "1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz")],
    tags: ["service_coding"],
    solutions: {
      python: "n = int(input())\nfor i in range(1, n + 1):\n    print('FizzBuzz' if i % 15 == 0 else 'Fizz' if i % 3 == 0 else 'Buzz' if i % 5 == 0 else i)",
      c: '#include <stdio.h>\nint main(void) {\n    int n;\n    scanf("%d", &n);\n    for (int i = 1; i <= n; i++) {\n        if (i % 15 == 0) puts("FizzBuzz");\n        else if (i % 3 == 0) puts("Fizz");\n        else if (i % 5 == 0) puts("Buzz");\n        else printf("%d\\n", i);\n    }\n    return 0;\n}',
      java: "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        int n = new Scanner(System.in).nextInt();\n        StringBuilder out = new StringBuilder();\n        for (int i = 1; i <= n; i++) out.append(i % 15 == 0 ? \"FizzBuzz\" : i % 3 == 0 ? \"Fizz\" : i % 5 == 0 ? \"Buzz\" : String.valueOf(i)).append('\\n');\n        System.out.print(out);\n    }\n}",
    },
  }),
  problem({
    id: "code-gcd-lcm",
    difficulty: 1,
    stem: "Read two positive integers a and b on one line. Print their greatest common divisor and least common multiple, separated by a space.",
    explanation: "Euclid's algorithm gives the GCD; LCM = a / gcd * b (divide first so the product doesn't overflow). Use 64-bit integers.",
    hints: ["gcd(a, b) = gcd(b, a % b), and gcd(a, 0) = a."],
    tests: [t("12 18", "6 36", false), t("7 13", "1 91", false), t("100 10", "10 100"), t("1000000 999999", "1 999999000000"), t("5 5", "5 5")],
    tags: ["service_coding"],
    solutions: {
      python: "from math import gcd\na, b = map(int, input().split())\ng = gcd(a, b)\nprint(g, a // g * b)",
      c: '#include <stdio.h>\nint main(void) {\n    long long a, b, x, y;\n    scanf("%lld %lld", &a, &b);\n    x = a; y = b;\n    while (y) { long long r = x % y; x = y; y = r; }\n    printf("%lld %lld\\n", x, a / x * b);\n    return 0;\n}',
      java: "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        long a = in.nextLong(), b = in.nextLong(), x = a, y = b;\n        while (y != 0) { long r = x % y; x = y; y = r; }\n        System.out.println(x + \" \" + (a / x * b));\n    }\n}",
    },
  }),
  problem({
    id: "code-missing-number",
    difficulty: 1,
    stem: "Read n. The next line has n - 1 different numbers from 1 to n. Print the one that is missing.",
    explanation: "The numbers 1 to n add up to n(n+1)/2; subtract the sum of what you were given.",
    hints: ["What should the numbers add up to?"],
    tests: [t("5\n1 2 4 5", "3", false), t("2\n2", "1", false), t("6\n6 5 4 3 2", "1"), t("4\n1 2 3", "4")],
    tags: ["service_coding"],
    solutions: {
      python: "n = int(input())\nprint(n * (n + 1) // 2 - sum(map(int, input().split())))",
      c: '#include <stdio.h>\nint main(void) {\n    long long n, x, sum = 0;\n    scanf("%lld", &n);\n    for (long long i = 0; i < n - 1; i++) { scanf("%lld", &x); sum += x; }\n    printf("%lld\\n", n * (n + 1) / 2 - sum);\n    return 0;\n}',
      java: "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        long n = in.nextLong(), sum = 0;\n        for (long i = 0; i < n - 1; i++) sum += in.nextLong();\n        System.out.println(n * (n + 1) / 2 - sum);\n    }\n}",
    },
  }),
  problem({
    id: "code-anagram",
    difficulty: 1,
    stem: "Read two words on one line. Print YES if they are anagrams of each other (the same letters, possibly in a different order, ignoring upper and lower case), otherwise NO.",
    explanation: "Count each letter in both words (or sort both) and compare.",
    hints: ["Words of different lengths can't be anagrams."],
    tests: [t("listen silent", "YES", false), t("apple paper", "NO", false), t("Dusty study", "YES"), t("ab abc", "NO"), t("a A", "YES")],
    skillId: DSA,
    tags: ["service_coding"],
    solutions: {
      python: "a, b = input().split()\nprint('YES' if sorted(a.lower()) == sorted(b.lower()) else 'NO')",
      c: '#include <stdio.h>\n#include <ctype.h>\nint main(void) {\n    char a[1001], b[1001];\n    int count[26] = {0}, ok = 1;\n    scanf("%1000s %1000s", a, b);\n    for (char *p = a; *p; p++) count[tolower(*p) - \'a\']++;\n    for (char *p = b; *p; p++) count[tolower(*p) - \'a\']--;\n    for (int i = 0; i < 26; i++) if (count[i]) ok = 0;\n    puts(ok ? "YES" : "NO");\n    return 0;\n}',
      java: "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        char[] a = in.next().toLowerCase().toCharArray(), b = in.next().toLowerCase().toCharArray();\n        Arrays.sort(a);\n        Arrays.sort(b);\n        System.out.println(Arrays.equals(a, b) ? \"YES\" : \"NO\");\n    }\n}",
    },
  }),
  problem({
    id: "code-letter-count",
    difficulty: 1,
    stem: "Read a word of lowercase letters. Print each letter that appears, in alphabetical order, followed by how many times it appears, separated by spaces (for example: a3 b1 n2).",
    explanation: "Count with an array of 26 (or a dictionary), then walk the letters in order and print the ones that appear.",
    hints: ["An array indexed by letter - 'a' makes the counting and the ordering easy."],
    tests: [t("banana", "a3 b1 n2", false), t("zzz", "z3", false), t("abcabc", "a2 b2 c2"), t("placement", "a1 c1 e2 l1 m1 n1 p1 t1")],
    skillId: DSA,
    solutions: {
      python: "from collections import Counter\nc = Counter(input().strip())\nprint(' '.join(f'{ch}{c[ch]}' for ch in sorted(c)))",
      c: '#include <stdio.h>\nint main(void) {\n    char s[1001];\n    int count[26] = {0}, first = 1;\n    scanf("%1000s", s);\n    for (char *p = s; *p; p++) count[*p - \'a\']++;\n    for (int i = 0; i < 26; i++) if (count[i]) { printf(first ? "%c%d" : " %c%d", \'a\' + i, count[i]); first = 0; }\n    printf("\\n");\n    return 0;\n}',
      java: "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        String s = new Scanner(System.in).next();\n        int[] count = new int[26];\n        for (char c : s.toCharArray()) count[c - 'a']++;\n        StringJoiner out = new StringJoiner(\" \");\n        for (int i = 0; i < 26; i++) if (count[i] > 0) out.add((char) ('a' + i) + String.valueOf(count[i]));\n        System.out.println(out);\n    }\n}",
    },
  }),
  problem({
    id: "code-pair-sum",
    difficulty: 2,
    stem: "The first line has n and k. The second line has n integers. Print YES if two of them, at different positions, add up to k. Otherwise print NO.",
    explanation: "Walk the numbers keeping a set of those seen so far; if k - x is already in the set, a pair exists. That's O(n) instead of checking every pair.",
    hints: ["For each x, which other number would you need?", "A number can't pair with itself unless it appears twice."],
    tests: [t("5 9\n2 7 11 15 1", "YES", false), t("4 10\n1 2 3 4", "NO", false), t("3 6\n3 1 2", "NO"), t("4 6\n3 1 3 2", "YES"), t("2 -4\n-2 -2", "YES")],
    skillId: DSA,
    tags: ["product_dsa"],
    solutions: {
      python: "n, k = map(int, input().split())\nseen, ok = set(), False\nfor x in map(int, input().split()):\n    if k - x in seen:\n        ok = True\n    seen.add(x)\nprint('YES' if ok else 'NO')",
      c: '#include <stdio.h>\nint main(void) {\n    int n; long long k, xs[100000];\n    scanf("%d %lld", &n, &k);\n    for (int i = 0; i < n; i++) scanf("%lld", &xs[i]);\n    for (int i = 0; i < n; i++)\n        for (int j = i + 1; j < n; j++)\n            if (xs[i] + xs[j] == k) { puts("YES"); return 0; }\n    puts("NO");\n    return 0;\n}',
      java: "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        int n = in.nextInt();\n        long k = in.nextLong();\n        Set<Long> seen = new HashSet<>();\n        boolean ok = false;\n        for (int i = 0; i < n; i++) {\n            long x = in.nextLong();\n            if (seen.contains(k - x)) ok = true;\n            seen.add(x);\n        }\n        System.out.println(ok ? \"YES\" : \"NO\");\n    }\n}",
    },
  }),
  problem({
    id: "code-rotate",
    difficulty: 2,
    stem: "The first line has n and k. The second line has n integers. Rotate them k places to the right and print them. k can be larger than n.",
    explanation: "Rotating by n changes nothing, so use k % n. The number at position i moves to (i + k) % n; equivalently position i takes the number from (i - k + n) % n.",
    hints: ["What does rotating by exactly n do?"],
    tests: [t("5 2\n1 2 3 4 5", "4 5 1 2 3", false), t("3 3\n7 8 9", "7 8 9", false), t("4 5\n1 2 3 4", "4 1 2 3"), t("1 100\n42", "42"), t("6 0\n1 2 3 4 5 6", "1 2 3 4 5 6")],
    skillId: DSA,
    solutions: {
      python: "n, k = map(int, input().split())\nxs = input().split()\nk %= n\nprint(' '.join(xs[n - k:] + xs[:n - k]))",
      c: '#include <stdio.h>\nint main(void) {\n    int n; long long k; int xs[100000];\n    scanf("%d %lld", &n, &k);\n    for (int i = 0; i < n; i++) scanf("%d", &xs[i]);\n    int r = (int) (k % n);\n    for (int i = 0; i < n; i++) printf(i ? " %d" : "%d", xs[(i - r + n) % n]);\n    printf("\\n");\n    return 0;\n}',
      java: "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        int n = in.nextInt();\n        int r = (int) (in.nextLong() % n);\n        int[] xs = new int[n];\n        for (int i = 0; i < n; i++) xs[i] = in.nextInt();\n        StringJoiner out = new StringJoiner(\" \");\n        for (int i = 0; i < n; i++) out.add(String.valueOf(xs[(i - r + n) % n]));\n        System.out.println(out);\n    }\n}",
    },
  }),
  problem({
    id: "code-first-unique",
    difficulty: 2,
    stem: "Read a word of lowercase letters. Print the position (counting from 0) of the first letter that appears only once in the word, or -1 if every letter repeats.",
    explanation: "Count every letter in one pass, then find the first position whose letter has a count of 1 in a second pass.",
    hints: ["Two passes: count, then look."],
    tests: [t("aabbcdd", "4", false), t("aabb", "-1", false), t("swiss", "1"), t("z", "0"), t("abacabad", "3")],
    skillId: DSA,
    tags: ["product_dsa"],
    solutions: {
      python: "s = input().strip()\nprint(next((i for i, ch in enumerate(s) if s.count(ch) == 1), -1))",
      c: '#include <stdio.h>\nint main(void) {\n    char s[1001];\n    int count[26] = {0};\n    scanf("%1000s", s);\n    for (char *p = s; *p; p++) count[*p - \'a\']++;\n    for (int i = 0; s[i]; i++) if (count[s[i] - \'a\'] == 1) { printf("%d\\n", i); return 0; }\n    puts("-1");\n    return 0;\n}',
      java: "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        String s = new Scanner(System.in).next();\n        int[] count = new int[26];\n        for (char c : s.toCharArray()) count[c - 'a']++;\n        int at = -1;\n        for (int i = 0; i < s.length(); i++) if (count[s.charAt(i) - 'a'] == 1) { at = i; break; }\n        System.out.println(at);\n    }\n}",
    },
  }),
  problem({
    id: "code-brackets",
    difficulty: 2,
    stem: "Read a line made only of the characters ( ) [ ] { }. Print YES if every bracket is closed by the matching kind, in the right order, otherwise NO.",
    explanation: "Push each opening bracket on a stack; a closing bracket must match the top of the stack. At the end the stack must be empty.",
    hints: ["Which bracket must the next closing one match?"],
    tests: [t("([]{})", "YES", false), t("([)]", "NO", false), t("(((", "NO"), t("{[()()]}", "YES"), t(")(", "NO")],
    skillId: DSA,
    tags: ["product_dsa"],
    solutions: {
      python: "pairs = {')': '(', ']': '[', '}': '{'}\nstack = []\nok = True\nfor ch in input().strip():\n    if ch in '([{':\n        stack.append(ch)\n    elif not stack or stack.pop() != pairs[ch]:\n        ok = False\n        break\nprint('YES' if ok and not stack else 'NO')",
      c: '#include <stdio.h>\nint main(void) {\n    char s[1001], stack[1001];\n    int top = 0, ok = 1;\n    scanf("%1000s", s);\n    for (char *p = s; *p && ok; p++) {\n        char c = *p;\n        if (c == \'(\' || c == \'[\' || c == \'{\') stack[top++] = c;\n        else {\n            char want = c == \')\' ? \'(\' : c == \']\' ? \'[\' : \'{\';\n            if (top == 0 || stack[--top] != want) ok = 0;\n        }\n    }\n    puts(ok && top == 0 ? "YES" : "NO");\n    return 0;\n}',
      java: "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        String s = new Scanner(System.in).next();\n        Deque<Character> stack = new ArrayDeque<>();\n        boolean ok = true;\n        for (char c : s.toCharArray()) {\n            if (c == '(' || c == '[' || c == '{') stack.push(c);\n            else {\n                char want = c == ')' ? '(' : c == ']' ? '[' : '{';\n                if (stack.isEmpty() || stack.pop() != want) { ok = false; break; }\n            }\n        }\n        System.out.println(ok && stack.isEmpty() ? \"YES\" : \"NO\");\n    }\n}",
    },
  }),
  problem({
    id: "code-merge-sorted",
    difficulty: 2,
    stem: "The first line has n and the second line n integers in increasing order. The third line has m and the fourth line m integers in increasing order. Print all n + m numbers in increasing order.",
    explanation: "Two pointers: compare the front of each list and take the smaller, then copy whatever is left. That's O(n + m), with no sorting.",
    hints: ["Both lists are already sorted: which number comes first overall?"],
    tests: [t("3\n1 4 9\n4\n2 3 10 12", "1 2 3 4 9 10 12", false), t("1\n5\n1\n5", "5 5", false), t("2\n-3 0\n3\n-5 -4 7", "-5 -4 -3 0 7"), t("4\n1 2 3 4\n1\n0", "0 1 2 3 4")],
    skillId: DSA,
    tags: ["product_dsa"],
    solutions: {
      python: "input()\na = list(map(int, input().split()))\ninput()\nb = list(map(int, input().split()))\ni = j = 0\nout = []\nwhile i < len(a) or j < len(b):\n    if j == len(b) or (i < len(a) and a[i] <= b[j]):\n        out.append(a[i]); i += 1\n    else:\n        out.append(b[j]); j += 1\nprint(' '.join(map(str, out)))",
      c: '#include <stdio.h>\nint a[100000], b[100000];\nint main(void) {\n    int n, m, i = 0, j = 0, first = 1;\n    scanf("%d", &n);\n    for (int k = 0; k < n; k++) scanf("%d", &a[k]);\n    scanf("%d", &m);\n    for (int k = 0; k < m; k++) scanf("%d", &b[k]);\n    while (i < n || j < m) {\n        int x = (j == m || (i < n && a[i] <= b[j])) ? a[i++] : b[j++];\n        printf(first ? "%d" : " %d", x);\n        first = 0;\n    }\n    printf("\\n");\n    return 0;\n}',
      java: "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        int n = in.nextInt();\n        int[] a = new int[n];\n        for (int k = 0; k < n; k++) a[k] = in.nextInt();\n        int m = in.nextInt();\n        int[] b = new int[m];\n        for (int k = 0; k < m; k++) b[k] = in.nextInt();\n        StringJoiner out = new StringJoiner(\" \");\n        int i = 0, j = 0;\n        while (i < n || j < m) out.add(String.valueOf(j == m || (i < n && a[i] <= b[j]) ? a[i++] : b[j++]));\n        System.out.println(out);\n    }\n}",
    },
  }),
  problem({
    id: "code-max-subarray",
    difficulty: 3,
    stem: "The first line has n. The second line has n integers. Print the largest sum of a contiguous, non-empty run of them.",
    explanation: "Kadane's algorithm: keep the best sum of a run ending at the current number (either extend the previous run or start fresh) and the best seen overall. O(n). Use 64-bit sums; if all numbers are negative the answer is the largest one.",
    hints: ["At each number, is it better to extend the run before it or start again?", "Don't start the best at 0: the run must be non-empty."],
    tests: [t("8\n-2 1 -3 4 -1 2 1 -5", "6", false), t("3\n-5 -2 -9", "-2", false), t("1\n7", "7"), t("5\n2 3 -10 4 4", "8"), t("6\n1000000000 1000000000 -1 1000000000 -3000000000 5", "2999999999")],
    skillId: DSA,
    tags: ["product_dsa"],
    solutions: {
      python: "input()\nxs = list(map(int, input().split()))\nbest = cur = xs[0]\nfor x in xs[1:]:\n    cur = max(x, cur + x)\n    best = max(best, cur)\nprint(best)",
      c: '#include <stdio.h>\nint main(void) {\n    int n; long long x, cur, best;\n    scanf("%d %lld", &n, &x);\n    cur = best = x;\n    for (int i = 1; i < n; i++) {\n        scanf("%lld", &x);\n        cur = cur + x > x ? cur + x : x;\n        if (cur > best) best = cur;\n    }\n    printf("%lld\\n", best);\n    return 0;\n}',
      java: "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        int n = in.nextInt();\n        long cur = in.nextLong(), best = cur;\n        for (int i = 1; i < n; i++) {\n            long x = in.nextLong();\n            cur = Math.max(x, cur + x);\n            best = Math.max(best, cur);\n        }\n        System.out.println(best);\n    }\n}",
    },
  }),
  problem({
    id: "code-longest-unique",
    difficulty: 3,
    stem: "Read a word. Print the length of its longest stretch of consecutive letters in which no letter repeats.",
    explanation: "Sliding window: remember where each letter was last seen; when a letter repeats inside the window, move the window's start just past its previous position. O(n).",
    hints: ["Keep a window with no repeats and grow it one letter at a time.", "When the new letter is already in the window, where must the window start?"],
    tests: [t("abcabcbb", "3", false), t("bbbbb", "1", false), t("pwwkew", "3"), t("a", "1"), t("abcdef", "6"), t("abba", "2")],
    skillId: DSA,
    tags: ["product_dsa"],
    solutions: {
      python: "s = input().strip()\nlast, start, best = {}, 0, 0\nfor i, ch in enumerate(s):\n    if last.get(ch, -1) >= start:\n        start = last[ch] + 1\n    last[ch] = i\n    best = max(best, i - start + 1)\nprint(best)",
      c: '#include <stdio.h>\nint main(void) {\n    char s[100001];\n    int last[256], start = 0, best = 0;\n    for (int i = 0; i < 256; i++) last[i] = -1;\n    scanf("%100000s", s);\n    for (int i = 0; s[i]; i++) {\n        unsigned char c = (unsigned char) s[i];\n        if (last[c] >= start) start = last[c] + 1;\n        last[c] = i;\n        if (i - start + 1 > best) best = i - start + 1;\n    }\n    printf("%d\\n", best);\n    return 0;\n}',
      java: "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        String s = new Scanner(System.in).next();\n        int[] last = new int[256];\n        Arrays.fill(last, -1);\n        int start = 0, best = 0;\n        for (int i = 0; i < s.length(); i++) {\n            int c = s.charAt(i) & 0xff;\n            if (last[c] >= start) start = last[c] + 1;\n            last[c] = i;\n            best = Math.max(best, i - start + 1);\n        }\n        System.out.println(best);\n    }\n}",
    },
  }),
);

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
