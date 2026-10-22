// Starter syllabus. Skill ids are "<topic>.<skill>"; readiness profiles in
// @playcode/core weight topics, so new skills slot in without code changes.

export interface SeedSkill {
  id: string;
  topic: string;
  topicName: string;
  name: string;
}

export const SKILLS: SeedSkill[] = [
  { id: "basics.io", topic: "basics", topicName: "Basics", name: "Output and printing" },
  { id: "basics.operators", topic: "basics", topicName: "Basics", name: "Operators" },
  { id: "conditionals.if", topic: "conditionals", topicName: "Conditionals", name: "If / else" },
  { id: "loops.for", topic: "loops", topicName: "Loops", name: "For loops" },
  { id: "loops.while", topic: "loops", topicName: "Loops", name: "While loops" },
  { id: "loops.nested", topic: "loops", topicName: "Loops", name: "Nested loops" },
  { id: "arrays.basics", topic: "arrays", topicName: "Arrays", name: "Array basics" },
  { id: "arrays.search", topic: "arrays", topicName: "Arrays", name: "Searching" },
  { id: "strings.basics", topic: "strings", topicName: "Strings", name: "String basics" },
  { id: "functions.basics", topic: "functions", topicName: "Functions", name: "Functions" },
  { id: "functions.scope", topic: "functions", topicName: "Functions", name: "Scope and parameters" },
  { id: "recursion.basics", topic: "recursion", topicName: "Recursion", name: "Recursion" },
  { id: "pointers.basics", topic: "pointers", topicName: "Pointers", name: "Pointers (C)" },
  { id: "oop.classes", topic: "oop", topicName: "OOP", name: "Classes and objects" },
  { id: "oop.inheritance", topic: "oop", topicName: "OOP", name: "Inheritance" },
  { id: "complexity.bigo", topic: "complexity", topicName: "Complexity", name: "Big-O" },
  { id: "pseudocode.basics", topic: "pseudocode", topicName: "Pseudocode", name: "Pseudocode rounds" },
  { id: "coding.basics", topic: "coding", topicName: "Coding", name: "Coding problems" },
  { id: "sql.basics", topic: "sql", topicName: "SQL", name: "SQL queries" },
];
