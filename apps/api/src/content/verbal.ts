import type { Difficulty } from "@playcode/core";
import { concept } from "./fundamentals";
import type { SeedQuestion } from "./questions";
import type { SeedSkill } from "./skills";

// Verbal ability for service-company tests (TCS NQT, Infosys, Wipro,
// Accenture, Capgemini all have an English section): grammar and sentence
// correction, vocabulary in context, and reading comprehension with sentence
// arrangement. Language questions have no program to prove the key, so each
// explanation states the rule or the line of the passage that decides it.

export const VERBAL_SKILLS: SeedSkill[] = [
  { id: "verbal.grammar", topic: "verbal", topicName: "Verbal ability", name: "Grammar and sentence correction" },
  { id: "verbal.vocabulary", topic: "verbal", topicName: "Verbal ability", name: "Vocabulary in context" },
  { id: "verbal.reading", topic: "verbal", topicName: "Verbal ability", name: "Reading comprehension and sentence order" },
];

const q = (
  id: string,
  skillId: string,
  difficulty: Difficulty,
  stem: string,
  explanation: string,
  options: string[],
  hints?: string[],
  verify?: string,
): SeedQuestion => concept({ id, skillId, difficulty, stem, explanation, verify, hints, tag: "service_verbal" }, options, 0);

const HIRING =
  "Many companies now hire through online tests before any interview. The tests are cheap to run for thousands of applicants, but they reward speed as much as understanding. Candidates who practise under timed conditions often score higher than equally able candidates who do not, simply because they waste less time deciding how to start.";
const RAIN =
  "Rainwater harvesting was common in Indian towns for centuries, through stepwells and tanks that stored the monsoon's water for the dry months. Many fell into disuse once piped water arrived. Today, as groundwater levels fall in several cities, some municipalities require new buildings to collect rainwater from their roofs.";
const METRO =
  "The new metro line cut the average commute from 70 minutes to 40. Yet ridership in the first year was half of what planners had forecast, largely because the stations were far from where most people lived and buses to them were infrequent.";
const passage = (text: string, question: string) => `Read the passage and answer the question.\n\n${text}\n\n${question}`;

export const VERBAL_QUESTIONS: SeedQuestion[] = [
  // ---------------- Grammar and sentence correction ----------------
  q(
    "vrb-gram-1", "verbal.grammar", 1,
    "Fill in the blank: Neither the manager nor the team members ___ aware of the change.",
    "With \"neither ... nor\", the verb agrees with the nearer subject. \"Team members\" is plural, so the verb is \"were\".",
    ["were", "was", "is", "has been"],
    ["Which subject is closer to the blank?"],
  ),
  q(
    "vrb-gram-2", "verbal.grammar", 1,
    "Which part of the sentence has an error?\n\nEach of the students (A) / have submitted (B) / the assignment (C) / before the deadline. (D)",
    "\"Each\" is singular, so it takes \"has submitted\". The error is in part B.",
    ["B", "A", "C", "D"],
    ["Is \"each\" singular or plural?"],
  ),
  q(
    "vrb-gram-3", "verbal.grammar", 1,
    "Which sentence is correct?",
    "An action that started in the past and is still going on takes the present perfect continuous with \"since\" for a point in time: \"has been working since 2019\".",
    ["She has been working here since 2019.", "She is working here since 2019.", "She has been working here for 2019.", "She works here since 2019."],
  ),
  q(
    "vrb-gram-4", "verbal.grammar", 2,
    "Fill in the blanks: He is ___ honest man and ___ university professor.",
    "Articles follow the sound, not the letter. \"Honest\" starts with a vowel sound (the h is silent), so \"an\"; \"university\" starts with a \"yu\" sound, so \"a\".",
    ["an, a", "a, an", "an, an", "a, a"],
    ["Say the words aloud: which starts with a vowel sound?"],
  ),
  q(
    "vrb-gram-5", "verbal.grammar", 2,
    "Fill in the blank: The new policy will come ___ effect from 1 April.",
    "The fixed phrase is \"come into effect\" (as is \"come into force\").",
    ["into", "in", "to", "on"],
  ),
  q(
    "vrb-gram-6", "verbal.grammar", 2,
    "Fill in the blank: If I ___ about the traffic, I would have left earlier.",
    "A condition about the past that didn't happen takes the past perfect in the if-clause and \"would have\" in the result: \"If I had known ..., I would have left\".",
    ["had known", "knew", "have known", "would know"],
    ["The result clause says \"would have left\": which tense goes with it?"],
  ),
  q(
    "vrb-gram-7", "verbal.grammar", 3,
    "Which sentence is correct?",
    "\"Scarcely\" at the start of a sentence inverts the verb (\"had I reached\") and pairs with \"when\". \"Than\" goes with \"no sooner\".",
    [
      "Scarcely had I reached the station when the train left.",
      "Scarcely I had reached the station when the train left.",
      "Scarcely had I reached the station than the train left.",
      "Scarcely had I reached the station then the train left.",
    ],
    ["Which word pairs with \"scarcely\", and which with \"no sooner\"?"],
  ),

  // ---------------- Vocabulary in context ----------------
  q(
    "vrb-vocab-1", "verbal.vocabulary", 1,
    "Choose the word closest in meaning to ABUNDANT.",
    "Abundant means existing in large quantities: plentiful. \"Scarce\" is its opposite.",
    ["Plentiful", "Scarce", "Hidden", "Expensive"],
  ),
  q(
    "vrb-vocab-2", "verbal.vocabulary", 1,
    "Choose the word opposite in meaning to TRANSPARENT.",
    "Transparent means letting light through so you can see through it; opaque means not letting light through. \"Clear\" and \"visible\" are close to transparent, not opposite.",
    ["Opaque", "Clear", "Fragile", "Visible"],
  ),
  q(
    "vrb-vocab-3", "verbal.vocabulary", 2,
    "In the sentence \"The committee's decision was unanimous\", what does \"unanimous\" mean?",
    "Unanimous (from Latin \"one mind\") means agreed by everyone involved.",
    ["Agreed by everyone", "Taken in secret", "Made in a hurry", "Opposed by most"],
  ),
  q(
    "vrb-vocab-4", "verbal.vocabulary", 2,
    "One word for a person who speaks two languages fluently:",
    "Bilingual: \"bi\" (two) + \"lingual\" (language). A bibliophile loves books, a linguist studies languages, and biennial means every two years.",
    ["Bilingual", "Bibliophile", "Linguist", "Biennial"],
  ),
  q(
    "vrb-vocab-5", "verbal.vocabulary", 2,
    "What does the idiom \"to hit the nail on the head\" mean?",
    "To hit the nail on the head is to describe exactly what is causing a situation or problem.",
    ["To describe exactly what is causing a problem", "To hurt someone on purpose", "To work hard with little result", "To make a careless mistake"],
  ),
  q(
    "vrb-vocab-6", "verbal.vocabulary", 3,
    "Choose the word that best fills the blank: Despite repeated warnings, the company remained ___ about the security flaw, and a data leak followed.",
    "\"Despite repeated warnings\" and the leak that followed point to a company that did nothing because it felt safe: complacent. \"Vigilant\" is the opposite, and an anxious company would have acted.",
    ["complacent", "vigilant", "anxious", "transparent"],
    ["What attitude would explain ignoring warnings?"],
  ),
  q(
    "vrb-vocab-7", "verbal.vocabulary", 3,
    "Choose the word opposite in meaning to EPHEMERAL.",
    "Ephemeral means lasting a very short time. Its opposite is permanent; \"brief\" is a synonym.",
    ["Permanent", "Brief", "Fragile", "Obscure"],
  ),

  // ---------------- Reading comprehension and sentence order ----------------
  q(
    "vrb-read-1", "verbal.reading", 2,
    passage(HIRING, "According to the passage, why do candidates who practise under timed conditions often score higher?"),
    "The last sentence gives the reason: \"because they waste less time deciding how to start\". The passage says they are equally able, so it isn't better understanding.",
    ["They waste less time deciding how to start", "They understand the subject better", "The tests are easier for them", "They are given more time"],
    ["Look for \"because\" in the passage."],
  ),
  q(
    "vrb-read-2", "verbal.reading", 2,
    passage(HIRING, "Which statement can be inferred from the passage?"),
    "Equally able candidates score differently depending on timed practice, so a score reflects familiarity with the format as well as ability. The tests come \"before any interview\", so interviews still happen, and speed matters as much as understanding.",
    [
      "An online test score partly reflects familiarity with the format, not only ability",
      "Online tests cost more to run than interviews",
      "Interviews have been replaced entirely by online tests",
      "Speed matters less than understanding in online tests",
    ],
  ),
  q(
    "vrb-read-3", "verbal.reading", 1,
    passage(RAIN, "Why, according to the passage, did many traditional water structures fall into disuse?"),
    "The second sentence: \"Many fell into disuse once piped water arrived.\"",
    ["Piped water arrived", "The monsoon became weaker", "Municipalities banned them", "Groundwater levels rose"],
  ),
  q(
    "vrb-read-4", "verbal.reading", 2,
    passage(RAIN, "What is the main idea of the passage?"),
    "The passage moves from an old practice, to its decline, to its return in a new form as groundwater falls. The other options either go beyond the passage or contradict it.",
    [
      "An old way of storing rainwater is coming back as groundwater declines",
      "Stepwells are the best way to store water",
      "Piped water has solved water shortages in cities",
      "Municipalities are building new stepwells",
    ],
    ["The main idea covers the whole passage, not one sentence."],
  ),
  q(
    "vrb-read-5", "verbal.reading", 3,
    passage(METRO, "Which step would most directly address the problem the passage describes?"),
    "Ridership was low because stations were far from homes and the buses to them were infrequent. Frequent feeder buses fix exactly that; faster or longer trains don't help people reach the stations.",
    ["Running frequent buses between homes and the stations", "Making the trains run faster", "Lowering next year's ridership forecast", "Adding more coaches to each train"],
    ["What does the passage say kept riders away?"],
  ),
  q(
    "vrb-read-6", "verbal.reading", 3,
    passage(METRO, "What is the author's main point?"),
    "The line did make commutes faster (70 to 40 minutes) yet drew half the forecast riders because it was hard to reach. The other options contradict the passage or claim more than it says.",
    ["A faster route attracts few riders if it is hard to reach", "The metro failed to cut commute times", "Planners' forecasts are always wrong", "Buses are faster than the metro"],
  ),
  q(
    "vrb-read-7", "verbal.reading", 2,
    "Arrange the sentences into a logical paragraph.\n\nP: Then she wrote a short program to test each idea.\nQ: Asha first read the problem twice to understand what was asked.\nR: Finally, she submitted the version that passed every sample.\nS: Next, she listed two possible approaches on paper.",
    "The sequence words decide it: \"first\" (Q), \"next\" (S), \"then\" (P), \"finally\" (R). Q also introduces Asha by name, so it must open the paragraph.",
    ["QSPR", "QPSR", "SQPR", "QSRP"],
    ["Look for words that mark order: first, next, then, finally."],
    `sentences = {"P": "Then she wrote", "Q": "Asha first read", "R": "Finally, she submitted", "S": "Next, she listed"}
order = ["first", "Next", "Then", "Finally"]
print("".join(sorted(sentences, key=lambda k: next(i for i, w in enumerate(order) if w in sentences[k]))))`,
  ),
];
