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
  "You are signed out of PlayCode and your institution's sign-in.": "आप PlayCode और अपने संस्थान के साइन-इन, दोनों से साइन आउट हो गए हैं।",
  "Get found by companies": "कंपनियों तक पहुँचें",
  "Join the talent pool and see invitations from companies": "टैलेंट पूल से जुड़ें और कंपनियों के आमंत्रण देखें",
  Invitations: "आमंत्रण",
  "Waiting for you": "आपके जवाब का इंतज़ार",
  Accepted: "स्वीकार किया",
  Declined: "मना किया",
  Lapsed: "समय निकल गया",
  "answer by {date}": "{date} तक जवाब दें",
  "Accept and share my contact": "स्वीकार करें और संपर्क साझा करें",
  Decline: "मना करें",
  "Apply to their drive": "उनकी ड्राइव में आवेदन करें",
  "They have your email and phone number and will contact you.": "उनके पास आपका ईमेल और फ़ोन नंबर है, वे आपसे संपर्क करेंगे।",
  "Talent pool": "टैलेंट पूल",
  "Your institution hasn't opened the talent pool yet. Ask your placement cell.": "आपके संस्थान ने अभी टैलेंट पूल नहीं खोला है। अपने प्लेसमेंट सेल से पूछें।",
  "Companies hiring on PlayCode can find you by your readiness, mastered skills and graduation year, and invite you to apply. They see your public profile (and your marks unless you hide them on your resume page), never your email or phone until you accept an invitation.": "PlayCode पर भर्ती करने वाली कंपनियाँ आपकी तैयारी, महारत वाली स्किल और ग्रेजुएशन वर्ष से आपको ढूँढ सकती हैं और आवेदन के लिए बुला सकती हैं। वे आपकी पब्लिक प्रोफ़ाइल देखती हैं (और आपके अंक, जब तक आप उन्हें रिज़्यूमे पेज पर छिपाते नहीं), लेकिन आमंत्रण स्वीकार करने तक आपका ईमेल या फ़ोन कभी नहीं।",
  "Where would you work? (optional, up to 5 cities)": "आप कहाँ काम करना चाहेंगे? (वैकल्पिक, 5 शहर तक)",
  "Bengaluru, Pune": "बेंगलुरु, पुणे",
  "Kinds of company (none ticked: any)": "कंपनी का प्रकार (कोई न चुनें: कोई भी)",
  "You are in the talent pool": "आप टैलेंट पूल में हैं",
  "Save preferences": "पसंद सेव करें",
  "Leave the pool": "पूल छोड़ें",
  "Join the talent pool": "टैलेंट पूल से जुड़ें",
  "Companies see what PlayCode measured, so practice raises your rank.": "कंपनियाँ वही देखती हैं जो PlayCode ने मापा है, इसलिए अभ्यास से आपकी रैंक बढ़ती है।",
  "Check what your profile shows": "देखें आपकी प्रोफ़ाइल क्या दिखाती है",
  "Leave the talent pool? Companies will no longer find you; invitations you already have stay here.": "टैलेंट पूल छोड़ें? कंपनियाँ अब आपको नहीं ढूँढ पाएँगी; जो आमंत्रण मिल चुके हैं वे यहीं रहेंगे।",
  "Accept? The company will see your email and phone number.": "स्वीकार करें? कंपनी आपका ईमेल और फ़ोन नंबर देख सकेगी।",
  Concepts: "अवधारणाएँ",
  "Keep it fresh": "याद ताज़ा रखें",
  "1 skill is fading": "1 स्किल भूलने लगी है",
  "{n} skills are fading": "{n} स्किल भूलने लगी हैं",
  "{n} questions, no hearts": "{n} सवाल, हार्ट नहीं कटेंगे",
  Review: "दोहराएँ",
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

  // Placements
  Placements: "प्लेसमेंट",
  "{n} drives open for you": "आपके लिए {n} ड्राइव खुली हैं",
  "{n} applications in progress": "{n} आवेदन प्रक्रिया में",
  "Next: {company}, register by {when}": "अगली: {company}, रजिस्ट्रेशन {when}",
  "Your record": "आपका रिकॉर्ड",
  backlogs: "बैकलॉग",
  "class 10": "कक्षा 10",
  "class 12": "कक्षा 12",
  "Your academic record is not on file yet. The placement cell adds it.": "आपका शैक्षणिक रिकॉर्ड अभी दर्ज नहीं है। इसे प्लेसमेंट सेल जोड़ता है।",
  "Something wrong? Tell your placement cell.": "कुछ गलत है? अपने प्लेसमेंट सेल को बताएँ।",
  "My applications": "मेरे आवेदन",
  "Open drives": "खुली ड्राइव",
  "No drives open right now. Keep practising: your readiness score is what companies' tests measure.": "अभी कोई ड्राइव खुली नहीं है। अभ्यास जारी रखें: कंपनियों के टेस्ट वही मापते हैं जो आपका रेडीनेस स्कोर बताता है।",
  "drive on {date}": "ड्राइव {date} को",
  Offer: "ऑफ़र",
  Closed: "बंद",
  Registered: "रजिस्टर्ड",
  Eligible: "योग्य",
  "Not eligible": "योग्य नहीं",
  "Congratulations! Offer of {ctc}.": "बधाई हो! {ctc} का ऑफ़र।",
  "Register by {date}. Rounds: {rounds}.": "{date} तक रजिस्टर करें। राउंड: {rounds}।",
  Register: "रजिस्टर करें",
  "Prepare: {mission}": "तैयारी: {mission}",
  "Practise the mission": "मिशन का अभ्यास करें",
  "Mock interview": "मॉक इंटरव्यू",
  Withdraw: "नाम वापस लें",
  "Withdraw your registration?": "अपना रजिस्ट्रेशन वापस लेना है?",
  cleared: "पास",
  "not selected": "चयन नहीं हुआ",
  "Could not load": "लोड नहीं हो सका",

  // Mock interviews
  "Practise a technical interview with AI": "AI के साथ टेक्निकल इंटरव्यू का अभ्यास करें",
  "Continue your interview": "अपना इंटरव्यू जारी रखें",
  "Your scorecard": "आपका स्कोरकार्ड",
  "How you spoke": "आप कैसे बोले",
  "{wpm} words a minute ({pace}) · {fillers} filler words per 100": "{wpm} शब्द प्रति मिनट ({pace}) · हर 100 शब्दों में {fillers} भराव शब्द",
  "a good pace": "अच्छी रफ़्तार",
  slow: "धीमी",
  fast: "तेज़",
  "Your pace was slow. Think first, then answer in full sentences without long pauses.": "आपकी रफ़्तार धीमी थी। पहले सोचें, फिर लंबे ठहराव के बिना पूरे वाक्यों में जवाब दें।",
  "You spoke fast. Slow down so the interviewer can follow your reasoning.": "आप तेज़ बोले। धीरे बोलें ताकि इंटरव्यूअर आपकी सोच समझ सके।",
  "Cut filler words (um, basically, actually). A short pause sounds more confident.": "भराव शब्द (um, basically, actually) कम करें। छोटा ठहराव ज़्यादा आत्मविश्वासी लगता है।",
  "Your answers were short. Explain your reasoning, not just the result.": "आपके जवाब छोटे थे। सिर्फ़ नतीजा नहीं, अपनी सोच भी समझाएँ।",
  "Clear delivery: steady pace and few fillers.": "साफ़ बोलना: स्थिर रफ़्तार और कम भराव शब्द।",
  "Read questions aloud": "सवाल पढ़कर सुनाएँ",
  "Hear again": "फिर से सुनें",
  "Spoken · {wpm} words a minute": "बोलकर · {wpm} शब्द प्रति मिनट",
  "Press Speak and answer out loud. You can fix the words before sending.": "बोलें दबाएँ और ज़ोर से जवाब दें। भेजने से पहले शब्द ठीक कर सकते हैं।",
  "This browser can't turn speech into text. Type your answers, or open PlayCode in Chrome or Edge.": "यह ब्राउज़र बोली को टेक्स्ट में नहीं बदल सकता। जवाब टाइप करें, या PlayCode को Chrome या Edge में खोलें।",
  "Microphone access is blocked. Allow it in your browser's site settings, or type your answer.": "माइक्रोफ़ोन की अनुमति बंद है। ब्राउज़र की साइट सेटिंग में इसे चालू करें, या जवाब टाइप करें।",
  "Speech recognition is turned off in this browser. Type your answer instead.": "इस ब्राउज़र में बोली पहचान बंद है। जवाब टाइप करें।",
  "No microphone was found.": "कोई माइक्रोफ़ोन नहीं मिला।",
  "Speech recognition needs an internet connection. Type your answer, or try again.": "बोली पहचान के लिए इंटरनेट चाहिए। जवाब टाइप करें, या फिर से कोशिश करें।",
  "Speech recognition stopped. Try again, or type your answer.": "बोली पहचान रुक गई। फिर से कोशिश करें, या जवाब टाइप करें।",
  "Listening...": "सुन रहे हैं...",
  Stop: "रोकें",
  Speak: "बोलें",
  "Answer by": "जवाब कैसे दें",
  "Type answers": "टाइप करके",
  "Speak answers": "बोलकर",
  "Questions are read aloud and you answer out loud, as in a real interview. Your browser turns speech into text (Chrome and Edge use their speech service); PlayCode keeps only the text and how long you spoke.": "सवाल पढ़कर सुनाए जाते हैं और आप असली इंटरव्यू की तरह बोलकर जवाब देते हैं। आपका ब्राउज़र बोली को टेक्स्ट में बदलता है (Chrome और Edge अपनी स्पीच सेवा इस्तेमाल करते हैं); PlayCode सिर्फ़ टेक्स्ट और आप कितनी देर बोले, यह रखता है।",
  "Speaking answers needs Chrome, Edge or Safari.": "बोलकर जवाब देने के लिए Chrome, Edge या Safari चाहिए।",
  spoken: "बोलकर",
  "Overall {n}/5": "कुल {n}/5",
  "Problem solving": "प्रॉब्लम सॉल्विंग",
  Fundamentals: "बुनियादी बातें",
  Communication: "बातचीत",
  Code: "कोड",
  "What went well": "क्या अच्छा रहा",
  "To work on": "किस पर काम करें",
  "Practise next:": "आगे अभ्यास करें:",
  "End the interview now? With at least two answers you still get a scorecard.": "इंटरव्यू अभी खत्म करें? कम से कम दो जवाब होने पर भी आपको स्कोरकार्ड मिलेगा।",
  "Product company interview": "प्रोडक्ट कंपनी इंटरव्यू",
  "Service company interview": "सर्विस कंपनी इंटरव्यू",
  "Focus: {skills}": "फ़ोकस: {skills}",
  End: "खत्म करें",
  "The interviewer is thinking...": "इंटरव्यूअर सोच रहा है...",
  "Writing your scorecard...": "आपका स्कोरकार्ड बन रहा है...",
  "Your answer": "आपका जवाब",
  "Answer as you would in the room. Explain your thinking.": "ऐसे जवाब दें जैसे इंटरव्यू रूम में देते। अपनी सोच समझाएँ।",
  "{n} answers left": "{n} जवाब बाकी",
  Send: "भेजें",
  "This interview ended before there was enough to score.": "स्कोर करने लायक जवाब मिलने से पहले यह इंटरव्यू खत्म हो गया।",
  "Back to interviews": "इंटरव्यू पर वापस जाएँ",
  "A short technical interview with an AI interviewer, about 15 minutes. It asks about the skills you are weakest in, follows up like a real panel, and ends with a scorecard.":
    "AI इंटरव्यूअर के साथ लगभग 15 मिनट का छोटा टेक्निकल इंटरव्यू। यह आपकी कमज़ोर स्किल पर सवाल पूछता है, असली पैनल की तरह आगे के सवाल करता है, और अंत में स्कोरकार्ड देता है।",
  "Service company": "सर्विस कंपनी",
  "Product company": "प्रोडक्ट कंपनी",
  "Starting...": "शुरू हो रहा है...",
  "Start interview": "इंटरव्यू शुरू करें",
  "{n} interviews left this week": "इस हफ़्ते {n} इंटरव्यू बाकी",
  "You have used this week's interviews. Practise the skills from your scorecard meanwhile.": "इस हफ़्ते के इंटरव्यू पूरे हो गए। तब तक अपने स्कोरकार्ड की स्किल का अभ्यास करें।",
  "Past interviews": "पिछले इंटरव्यू",
  "In progress": "जारी है",
  "Not scored": "स्कोर नहीं हुआ",

  // Question reports
  "Something wrong with this question?": "इस सवाल में कुछ गलत है?",
  "What's wrong?": "क्या गलत है?",
  "The answer marked correct is wrong": "सही बताया गया जवाब गलत है",
  "The question is unclear": "सवाल साफ़ नहीं है",
  "There's a typo or formatting problem": "टाइपिंग या फ़ॉर्मेटिंग की गलती है",
  "Something else": "कुछ और",
  "Details (optional)": "विवरण (वैकल्पिक)",
  "Send report": "रिपोर्ट भेजें",
  Cancel: "रद्द करें",
  "Thanks. The content team will check this question.": "धन्यवाद। कंटेंट टीम इस सवाल की जाँच करेगी।",

  // Licence
  "Your institution's PlayCode licence has ended. Practice keeps working until {date}.": "आपके संस्थान का PlayCode लाइसेंस खत्म हो गया है। {date} तक अभ्यास चलता रहेगा।",
  "Your institution's PlayCode licence has ended. You can still see your progress, but practice is paused until it is renewed.":
    "आपके संस्थान का PlayCode लाइसेंस खत्म हो गया है। आप अपनी प्रगति देख सकते हैं, लेकिन नवीनीकरण होने तक अभ्यास रुका रहेगा।",

  // Push notifications
  "Notifications on this phone": "इस फ़ोन पर नोटिफ़िकेशन",
  "Get streak, assignment, test and placement reminders as phone notifications. Free, and you can turn them off any time.":
    "स्ट्रीक, असाइनमेंट, टेस्ट और प्लेसमेंट के रिमाइंडर फ़ोन नोटिफ़िकेशन के रूप में पाएँ। मुफ़्त, और आप कभी भी बंद कर सकते हैं।",
  "This browser can't show notifications. On iPhone, add PlayCode to your home screen first, then open it from there.":
    "यह ब्राउज़र नोटिफ़िकेशन नहीं दिखा सकता। iPhone पर पहले PlayCode को होम स्क्रीन पर जोड़ें, फिर वहीं से खोलें।",
  "Turn off on this phone": "इस फ़ोन पर बंद करें",
  "Turn on notifications": "नोटिफ़िकेशन चालू करें",
  "Notifications are blocked for this site. Allow them in your browser settings.": "इस साइट के लिए नोटिफ़िकेशन बंद हैं। अपने ब्राउज़र की सेटिंग में इन्हें चालू करें।",
  "This browser couldn't set up notifications. Try again, or use Chrome, Edge or Firefox.": "यह ब्राउज़र नोटिफ़िकेशन सेट नहीं कर सका। फिर से कोशिश करें, या Chrome, Edge या Firefox इस्तेमाल करें।",

  // Resume
  "My resume": "मेरा रिज़्यूमे",
  "A resume and public profile built from your verified PlayCode record": "आपके सत्यापित PlayCode रिकॉर्ड से बना रिज़्यूमे और पब्लिक प्रोफ़ाइल",
  "Download PDF": "PDF डाउनलोड करें",
  "About you": "आपके बारे में",
  Headline: "हेडलाइन",
  About: "परिचय",
  "e.g. Final-year CSE student who enjoys Java and SQL": "जैसे: अंतिम वर्ष का CSE छात्र जिसे Java और SQL पसंद है",
  "Two or three lines about what you have built and what you want to do.": "आपने क्या बनाया है और आगे क्या करना चाहते हैं, दो-तीन पंक्तियों में।",
  "Verified by {app}": "{app} द्वारा सत्यापित",
  "These come from your practice and can't be edited. Practise more to improve them.": "ये आपके अभ्यास से आते हैं और बदले नहीं जा सकते। इन्हें बेहतर करने के लिए और अभ्यास करें।",
  "Service companies": "सर्विस कंपनियाँ",
  "Product companies": "प्रोडक्ट कंपनियाँ",
  "{q} questions, {c} coding and {s} SQL problems solved · {d} practice days in 90": "{q} सवाल, {c} कोडिंग और {s} SQL प्रॉब्लम हल · 90 में से {d} दिन अभ्यास",
  "Mock interview: {n}/5": "मॉक इंटरव्यू: {n}/5",
  "Skills appear here once you reach 60% mastery with at least 5 answers.": "कम से कम 5 जवाबों के साथ 60% महारत होने पर स्किल यहाँ दिखेंगी।",
  "{n} verified certificates": "{n} सत्यापित प्रमाणपत्र",
  "Public profile": "पब्लिक प्रोफ़ाइल",
  "A link you can put on your resume or send to recruiters. It shows your name, college, verified skills and certificates, but not your email, phone, roll number or marks.":
    "एक लिंक जिसे आप रिज़्यूमे में डाल सकते हैं या रिक्रूटर्स को भेज सकते हैं। इसमें आपका नाम, कॉलेज, सत्यापित स्किल और प्रमाणपत्र दिखते हैं, लेकिन ईमेल, फ़ोन, रोल नंबर या अंक नहीं।",
  "Copy link": "लिंक कॉपी करें",
  "Link copied": "लिंक कॉपी हो गया",
  "Make private": "प्राइवेट करें",
  "Create public link": "पब्लिक लिंक बनाएँ",
  "Show on my resume and public profile:": "मेरे रिज़्यूमे और पब्लिक प्रोफ़ाइल पर दिखाएँ:",
  "Readiness scores": "रेडीनेस स्कोर",
  "Mock interview score": "मॉक इंटरव्यू स्कोर",
  "CGPA and class 10/12 marks (resume PDF only)": "CGPA और कक्षा 10/12 के अंक (सिर्फ़ रिज़्यूमे PDF में)",
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
