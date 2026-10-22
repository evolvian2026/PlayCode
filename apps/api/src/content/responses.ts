import type { StudentResponse } from "@playcode/core";
import type { SeedQuestion } from "./questions";

// Right and wrong answers for seeded questions, used by the demo simulation
// and the tests.

export function correctResponse(q: SeedQuestion): StudentResponse {
  const a = q.answer;
  switch (a.kind) {
    case "option":
      return { kind: "option", optionId: a.optionId };
    case "text":
      return { kind: "text", value: a.accepted[0]! };
    case "lines":
      return { kind: "lines", lines: a.lines };
    case "order":
      return { kind: "order", ids: a.orders[0]! };
    case "tests":
      return { kind: "code", language: "python", source: q.solutions?.python ?? a.reference?.source ?? "" };
    case "sql":
      return { kind: "sql", query: a.solution };
  }
}

export function wrongResponse(q: SeedQuestion): StudentResponse {
  const a = q.answer;
  switch (a.kind) {
    case "option":
      return { kind: "option", optionId: q.body.options!.find((o) => o.id !== a.optionId)!.id };
    case "text":
      return { kind: "text", value: "not sure" };
    case "lines":
      return { kind: "lines", lines: [a.lines[0] === 1 ? 2 : 1] };
    case "order":
      return { kind: "order", ids: [...a.orders[0]!].reverse() };
    case "tests":
      return { kind: "code", language: "python", source: "print(0)" };
    case "sql":
      return { kind: "sql", query: "SELECT 1" };
  }
}
