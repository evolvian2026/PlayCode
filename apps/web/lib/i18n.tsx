"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";

// Interface language for the student app. English strings are the keys;
// a missing Hindi entry falls back to English, so screens can be translated
// one at a time. Code, question text and technical terms stay in English, as
// they appear in placement tests.

export type Locale = "en" | "hi";
export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "hi", label: "हिन्दी" },
];

const HI: Record<string, string> = {
  // Shell
  Home: "होम",
  Learn: "सीखें",
  Missions: "मिशन",
  Duels: "ड्यूल",
  League: "लीग",
  Me: "मैं",
  Messages: "संदेश",
  "Total XP": "कुल XP",
  "Day streak": "लगातार दिन",
  "Practise today to keep your streak": "स्ट्रीक बनाए रखने के लिए आज अभ्यास करें",
  "Hearts for Learn practice": "Learn अभ्यास के लिए दिल",
  "Weekly league division": "साप्ताहिक लीग डिवीज़न",
  Loading: "लोड हो रहा है",

  // Home
  "Hi {name}": "नमस्ते {name}",
  "Level {level} {title} · {n} XP to level {next}": "लेवल {level} {title} · लेवल {next} के लिए {n} XP",
  "Answer one question today to keep your {n}-day streak.": "अपनी {n} दिन की स्ट्रीक बनाए रखने के लिए आज एक सवाल का जवाब दें।",
  "A classmate challenged you to a duel": "एक सहपाठी ने आपको ड्यूल की चुनौती दी है",
  "{n} duel challenges waiting": "{n} ड्यूल चुनौतियाँ इंतज़ार में",
  "Daily challenge": "आज की चुनौती",
  "5 questions · same for everyone at {org}": "5 सवाल · {org} में सबके लिए एक जैसे",
  "Done for today: {correct}/{total} correct. Come back tomorrow.": "आज का हो गया: {total} में से {correct} सही। कल फिर आइए।",
  "Start daily challenge": "आज की चुनौती शुरू करें",
  "Continue daily challenge": "आज की चुनौती जारी रखें",
  "Live event": "लाइव इवेंट",
  "{team} is #{rank} of {count}. Every XP you earn counts for your team.": "{team} {count} में #{rank} पर है। आपका हर XP आपकी टीम के लिए गिना जाता है।",
  "Earn XP for your team.": "अपनी टीम के लिए XP कमाएँ।",
  "Tests open now": "अभी खुले टेस्ट",
  "{min} min · closes {when}": "{min} मिनट · बंद होगा {when}",
  Resume: "जारी रखें",
  Open: "खोलें",
  "{done}/{total} steps": "{total} में से {done} चरण",
  "Next:": "अगला:",
  overdue: "देर हो गई",
  Continue: "जारी रखें",
  Start: "शुरू करें",
  "Assigned to you": "आपको दिया गया काम",
  "{n} questions · {due}": "{n} सवाल · {due}",
  "within the hour": "एक घंटे के अंदर",
  "in {n} h": "{n} घंटे में",
  "in {n} d": "{n} दिन में",
  "due {when}": "जमा करना है {when}",
  "Suggested next": "अगला सुझाव",
  Practise: "अभ्यास करें",
  "{division} league": "{division} लीग",
  "of {size} · {xp} XP this week": "{size} में · इस हफ़्ते {xp} XP",
  "Earn XP to join this week": "इस हफ़्ते शामिल होने के लिए XP कमाएँ",
  "Mistakes to review": "दोहराने वाली गलतियाँ",
  "Fix one to earn a heart": "एक ठीक करें और एक दिल पाएँ",
  "All clear": "सब ठीक है",

  // Question player
  "Leave session": "सेशन छोड़ें",
  "Run sample tests": "सैंपल टेस्ट चलाएँ",
  "Run query": "क्वेरी चलाएँ",
  "Running...": "चल रहा है...",
  "Running all tests...": "सभी टेस्ट चल रहे हैं...",
  "Checking...": "जाँच हो रही है...",
  Submit: "जमा करें",
  Check: "जाँचें",
  "Use a hint (costs some XP)": "संकेत लें (कुछ XP लगेंगे)",
  "Ask the AI coach (costs some XP)": "AI कोच से पूछें (कुछ XP लगेंगे)",
  "Ask the coach about my code": "मेरे कोड के बारे में कोच से पूछें",
  "Coach is thinking...": "कोच सोच रहा है...",
  "Coach:": "कोच:",
  "Correct!": "सही!",
  "Not quite": "पूरी तरह सही नहीं",
  "Correct answer": "सही जवाब",
  "Model solution": "मॉडल समाधान",
  "See results": "नतीजे देखें",
  "Save and exit": "सेव करके बाहर निकलें",
  "Sample tests": "सैंपल टेस्ट",
  "All tests": "सभी टेस्ट",
  "Your query's result": "आपकी क्वेरी का नतीजा",
  "Mission cleared!": "मिशन पूरा!",
  "Not this time": "इस बार नहीं",
  "Set complete": "सेट पूरा",
  "correct ({pct}%)": "सही ({pct}%)",
  "XP earned": "XP कमाए",
  "Pass mark {n}%.": "पास मार्क {n}%।",
  "You can retry any time to improve your best score.": "अपना सबसे अच्छा स्कोर सुधारने के लिए कभी भी दोबारा कोशिश करें।",
  "Review your mistakes, then try again.": "अपनी गलतियाँ देखें, फिर दोबारा कोशिश करें।",
  "You ran out of hearts. Review a mistake to earn one back.": "आपके दिल खत्म हो गए। एक गलती दोहराकर एक दिल वापस पाएँ।",
  "Path complete: {title}. View certificate": "पाथ पूरा: {title}। प्रमाणपत्र देखें",
  "View your certificate": "अपना प्रमाणपत्र देखें",
  Easy: "आसान",
  Medium: "मध्यम",
  Hard: "कठिन",
  "Type your answer": "अपना जवाब लिखें",

  // Question types
  "Predict the output": "आउटपुट बताइए",
  "Spot the bug": "गलती ढूँढिए",
  "Fill in the blank": "खाली जगह भरिए",
  "Reorder the lines": "लाइनों को सही क्रम में लगाइए",
  "Which snippet?": "कौन-सा कोड?",
  Complexity: "कॉम्प्लेक्सिटी",
  "Trace the variable": "वेरिएबल ट्रेस कीजिए",
  "Reverse mode": "रिवर्स मोड",
  Pseudocode: "स्यूडोकोड",
  "Write code": "कोड लिखिए",
  "SQL query": "SQL क्वेरी",

  // Learning paths
  "Learning paths": "लर्निंग पाथ",
  "No learning paths yet. Your teachers or managers set them up.": "अभी कोई लर्निंग पाथ नहीं है। आपके शिक्षक या मैनेजर इन्हें बनाते हैं।",
  "Completed: view certificate": "पूरा: प्रमाणपत्र देखें",
  "Reach {n}% mastery": "{n}% महारत हासिल करें",
  "Score {n}% or more": "{n}% या ज़्यादा स्कोर करें",
  "not started": "शुरू नहीं किया",
  "{n}% now": "अभी {n}%",
  "best {n}%": "सबसे अच्छा {n}%",
  "was due {date}": "{date} तक करना था",
  "due {date}": "{date} तक",
  "Mission · ": "मिशन · ",
  Locked: "बंद",

  // Profile
  "Sign out": "साइन आउट",
  Certificates: "प्रमाणपत्र",
  View: "देखें",
  "Share the link with recruiters: it shows the certificate and proves it is genuine.": "यह लिंक रिक्रूटर्स को भेजें: इससे प्रमाणपत्र दिखता है और साबित होता है कि यह असली है।",
  Reminders: "रिमाइंडर",
  "Streak, assignment and test reminders always appear in Messages. Add a number to get them on WhatsApp too.":
    "स्ट्रीक, असाइनमेंट और टेस्ट के रिमाइंडर हमेशा संदेशों में आते हैं। WhatsApp पर पाने के लिए नंबर जोड़ें।",
  Save: "सेव करें",
  Saved: "सेव हो गया",
  "Send me WhatsApp reminders": "मुझे WhatsApp पर रिमाइंडर भेजें",
  "Placement readiness": "प्लेसमेंट की तैयारी",
  Badges: "बैज",
  "Answer your first question to earn a badge.": "बैज पाने के लिए अपने पहले सवाल का जवाब दें।",
  Skills: "स्किल",
  Language: "भाषा",
  "Choose the language for menus and buttons. Questions and code stay in English, as in placement tests.":
    "मेनू और बटन की भाषा चुनें। सवाल और कोड अंग्रेज़ी में ही रहेंगे, जैसे प्लेसमेंट टेस्ट में होते हैं।",
  "Privacy and your data": "प्राइवेसी और आपका डेटा",
  "Download my data": "मेरा डेटा डाउनलोड करें",
  "Signed-in devices": "साइन-इन डिवाइस",
  "This device": "यह डिवाइस",
  "Sign out other devices": "दूसरे डिवाइस से साइन आउट करें",

  // Sign-in
  Email: "ईमेल",
  Password: "पासवर्ड",
  "Sign in": "साइन इन करें",
  "Signing in...": "साइन इन हो रहा है...",
  "Forgot your password? Get a sign-in code instead": "पासवर्ड भूल गए? इसकी जगह साइन-इन कोड लें",
  "Email me a code": "मुझे कोड ईमेल करें",
  "Send the code to my WhatsApp": "कोड मेरे WhatsApp पर भेजें",
  "Back to password sign-in": "पासवर्ड से साइन इन पर वापस जाएँ",
  "Sign-in code": "साइन-इन कोड",
  "Two-factor code": "टू-फ़ैक्टर कोड",
  "Start again": "फिर से शुरू करें",
  "Level up your coding for placements": "प्लेसमेंट के लिए अपनी कोडिंग निखारें",
  "Sign in with Google": "Google से साइन इन करें",
  "Sign in with Microsoft": "Microsoft से साइन इन करें",
  "Sign in with your institution account": "अपने संस्थान के अकाउंट से साइन इन करें",
  "or sign in with your PlayCode password below": "या नीचे अपने PlayCode पासवर्ड से साइन इन करें",
  "If this email has an account with a phone number, a code is on its way to WhatsApp.": "अगर इस ईमेल का अकाउंट है और उसमें फ़ोन नंबर है, तो कोड WhatsApp पर भेजा जा रहा है।",
  "If this email has an account, a code is on its way. Check your inbox.": "अगर इस ईमेल का अकाउंट है, तो कोड भेजा जा रहा है। अपना इनबॉक्स देखें।",
  "Open your authenticator app and enter the 6-digit code for PlayCode. Lost your phone? Use a recovery code.":
    "अपना ऑथेंटिकेटर ऐप खोलें और PlayCode का 6 अंकों का कोड डालें। फ़ोन खो गया? रिकवरी कोड इस्तेमाल करें।",
  "day streak (best {n})": "दिन की स्ट्रीक (सबसे अच्छी {n})",
  "correct answers": "सही जवाब",
  "Based on your mastery of the topics each kind of company tests. Skills you have not practised in a month count for less.":
    "हर तरह की कंपनी जिन टॉपिक्स का टेस्ट लेती है, उनमें आपकी महारत के आधार पर। जिन स्किल का एक महीने से अभ्यास नहीं किया, वे कम गिनी जाती हैं।",
  "{division} division": "{division} डिवीज़न",
  Tests: "टेस्ट",
  "Mistake notebook ({n})": "गलतियों की कॉपी ({n})",
  "{mastery}% · {acc}% right": "{mastery}% · {acc}% सही",
};

const STORAGE_KEY = "playcode.locale";

export function storedLocale(): Locale {
  try {
    return localStorage.getItem(STORAGE_KEY) === "hi" ? "hi" : "en";
  } catch {
    return "en";
  }
}

export function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage blocked: the account setting still applies after sign-in.
  }
}

export type Translate = (text: string, vars?: Record<string, string | number>) => string;

export function translate(locale: Locale, text: string, vars?: Record<string, string | number>): string {
  let out = locale === "hi" ? (HI[text] ?? text) : text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

const LocaleContext = createContext<Locale>("en");

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = locale;
    storeLocale(locale);
  }, [locale]);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): Translate {
  const locale = useContext(LocaleContext);
  return (text, vars) => translate(locale, text, vars);
}
