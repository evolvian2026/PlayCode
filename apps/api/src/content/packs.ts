// Company-pattern missions: fixed sets with a pass mark, mapped to the test
// patterns students face in placement drives.

export interface SeedPack {
  id: string;
  kind: "mission" | "set";
  title: string;
  description: string;
  questionIds: string[];
  passMark: number;
  profile?: string;
}

export const PACKS: SeedPack[] = [
  {
    id: "mission-service-pseudocode",
    kind: "mission",
    title: "Service-company pseudocode round",
    description: "Pseudocode and output questions in the style of mass-recruiter online tests.",
    questionIds: ["pseudo-basics-1", "pseudo-basics-2", "pseudo-basics-3", "pseudo-basics-4", "pseudo-basics-5", "c-cond-1", "java-basics-io-1", "c-for-1"],
    passMark: 60,
    profile: "service",
  },
  {
    id: "mission-c-fundamentals",
    kind: "mission",
    title: "C fundamentals round",
    description: "Operators, loops, arrays, strings and pointers in C.",
    questionIds: ["c-basics-ops-1", "c-nested-1", "c-arr-1", "c-str-1", "c-fn-1", "c-ptr-1", "c-ptr-2", "c-ptr-bug-1"],
    passMark: 60,
    profile: "service",
  },
  {
    id: "mission-java-oop",
    kind: "mission",
    title: "Java OOP round",
    description: "Strings, classes and inheritance as asked in technical MCQ rounds.",
    questionIds: ["java-basics-io-1", "java-str-1", "java-str-trace-1", "java-oop-1", "java-oop-2", "java-oop-3", "java-arr-bug-1", "java-while-fill-1"],
    passMark: 60,
    profile: "service",
  },
  {
    id: "mission-product-dsa",
    kind: "mission",
    title: "Product-company DSA warm-up",
    description: "Complexity, recursion and searching, the base of product-company coding rounds.",
    questionIds: ["cx-1", "cx-2", "cx-3", "cx-4", "cx-5", "py-rec-1", "py-rec-reverse-1", "py-search-which-1"],
    passMark: 70,
    profile: "product",
  },
  {
    id: "mission-coding-round",
    kind: "mission",
    title: "Online coding round",
    description: "Three programs and a SQL query, run against hidden tests like a real online assessment.",
    questionIds: ["code-reverse-words", "code-second-largest", "code-primes", "sql-unplaced"],
    passMark: 75,
    profile: "product",
  },
];
