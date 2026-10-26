# PlayCode

Gamified coding practice and placement readiness, sold to institutions (B2B).
Coding is broken into short, aptitude-style questions (predict the output, spot
the bug, reorder the lines and more), wrapped in XP, streaks, hearts, leagues
and missions. Colleges get assignments, analytics and a readiness score per
student.

This covers Phases 1 to 3 of the product and architecture spec, Phase 4 (which closes the roadmap items they left open), Phase 5 (enterprise readiness and scale) and the phases after it, listed below.

## What is in this build

**Student app** (`/play`, mobile first)
- Home: daily challenge (the same 5 questions for the whole institution each day), assigned work, a suggested skill, league position, mistakes to review.
- Learn map: topics and skills with mastery bars; 8-question practice sets that cost a heart per wrong answer.
- Question player for all nine no-execution question types: predict the output, spot the bug, fill in the blank, reorder lines (Parsons), which snippet, complexity, trace the variable, reverse mode, pseudocode. Hints cost XP; every answer gets an explanation.
- Missions: company-pattern rounds with a pass mark.
- Weekly leagues (Bronze to Diamond, groups of 30, promotion and demotion zones), streaks with monthly freezes, hearts that refill over time or by fixing a past mistake, levels and badges.
- Profile: placement readiness (service and product company profiles), skill mastery, badges, mistake notebook.

**Phase 2 additions**
- Live coding: write-code problems in C, Java and Python run against sample and hidden stdin/stdout tests; SQL questions run against sample tables. CodeMirror editor with run, submit, saved drafts and test-by-test feedback.
- 1v1 duels: challenge a classmate or get matched by rating; same five questions, three minutes, Elo duel rating, live updates over WebSocket.
- Proctored tests: sections with marks and negative marking, per-student random questions, server-side timer with autosave and auto-submit, integrity signals (tab switches, focus, full screen, copy/paste, device changes), webcam snapshots and one-device lock for strict tests, code-similarity checks, a live proctor monitor (extra time, force submit, device reset) and a results release step.
- Events: section-vs-section (run by the institution) and inter-college (run by PlayCode) competitions ranked by XP per member.
- Nudges: automatic reminders (streak at risk, assignment due, test open) and TPO announcements to filtered groups, delivered in-app and on WhatsApp.

**Phase 3 additions**
- Partner programme: training partners resell PlayCode under their own brand, run several colleges from one seat pool and switch into any of them. White-label branding (name, colour, logo, certificate signatory) flows from partner to college.
- Certificates for passed missions, each with a public verification page and QR code (`/verify/<code>`).
- Public API v1 (`/v1`, OAuth client credentials with scopes) for ERP/LMS sync: students, org units, assignments, results and readiness. Signed webhooks (HMAC-SHA256) with retries for `user.created`, `assignment.completed`, `assessment.submitted`, `assessment.results_released`, `certificate.issued`, `candidate.registered`, `candidate.status_changed` and `user.erased`.
- Corporate hiring drives: companies publish a drive with a public apply link (`/apply/<code>`), candidates register and take a proctored test, recruiters shortlist, reject or hire and export a CSV.
- Single sign-on with OpenID Connect: Google Workspace, Microsoft Entra ID or any OIDC provider, with allowed email domains and optional auto-provisioning into a batch.
- Privacy tools (built for India's DPDP Act 2023): privacy notice and WhatsApp consent in an append-only ledger, "download my data" for students, deletion requests that admins approve or decline, and a filterable audit log.

**Phase 4 additions**
- AI coach in practice: when written hints aren't enough, students ask for a hint tailored to the question and, for code and SQL, to their own attempt. It never gives the answer (hints that contain it are thrown away and regenerated), costs XP like a written hint, is capped at 3 per question and 25 a day, and is never available in tests or duels. Hints that don't involve the student's code are cached and reused.
- Content studio (`/console/studio`): institutions write private questions for their own students; the PlayCode content team edits the global bank. Every question is validated and, where possible, run before it can go live: output questions run their code and compare it with the answer, coding problems run each reference solution against every test, and SQL model answers must return rows. Edits to live questions must pass the check too. Live student preview.
- AI drafting in the studio: Claude drafts quick question types (predict the output, spot the bug, complexity, trace, pseudocode, fill the blank, which snippet) for a chosen skill, language and difficulty; each draft is checked by running it before the author reviews and publishes.
- Proctoring level 3: every webcam snapshot is reviewed by AI for no face, more than one face, a phone or a second person. Findings become integrity events with the photo as evidence and raise the risk score; proctors see flagged photos first. Nothing is decided automatically.
- LTI 1.3: Moodle, Canvas or any LTI 1.3 LMS launches PlayCode assignments from inside a course (students are signed in and, optionally, created in a chosen batch), and the score goes to the course gradebook through Assignment and Grade Services. Teachers connect each course activity to an assignment from the console.

**Phase 5 additions**
- Learning paths: ordered skills to master and missions to pass, with deadlines, for a batch (placement tracks) or a company team (onboarding and upskilling). Progress comes from normal practice, steps can unlock in order, managers see a progress grid with who is behind (CSV export), and finishing a path earns a verifiable certificate and a `path.completed` webhook.
- Weekly PDF reports: activity, readiness, weakest skills, assignments, learning paths and students who need help, in the institution's branding. Download any time, or subscribe to get it by email on a chosen day and hour.
- SAML 2.0 single sign-on alongside OpenID Connect, for ADFS, Shibboleth, Okta and similar identity providers (metadata import, published SP metadata, signed assertions required).
- LTI deep linking: teachers pick PlayCode assignments from inside Moodle or Canvas; each becomes a course activity with a gradebook column.
- Several API instances can run behind a load balancer: live events reach browsers on any instance (Postgres LISTEN/NOTIFY) and rate limits are shared (Postgres counters).

**Phase 6 additions**
- Plans: Starter, Pro and Enterprise decide which features an institution gets (camera and AI proctoring, content studio, AI coach and drafting, learning paths, report emails, SSO and SAML, LTI, API, white label, WhatsApp, hiring drives). Locked features are hidden in the console and refused by the API with a "part of the Pro plan" message. Partners can't give a college a higher plan than their own.
- Billing: the institution admin sees their plan, seats, AI tokens used this month against the plan's allowance (AI pauses at the limit on Pro; Enterprise is billed for overage) and their invoices, and keeps their GSTIN and billing address. The PlayCode super admin issues monthly GST tax invoices for every customer in one step (numbered `PC/2026-27/0001` by financial year, CGST and SGST within the state, IGST otherwise, SAC 998431, amount in words) as PDFs, and marks them paid or void.
- Sign-in codes: anyone can sign in with a 6-digit code sent by email or WhatsApp instead of a password (10 minutes, 5 tries, one use).
- Two-factor sign-in for staff with an authenticator app (TOTP) and 8 one-time recovery codes. An institution admin can require it for all staff; staff without it are sent to set it up before they can do anything else. Admins can reset a colleague's two-factor.
- Signed-in devices: every sign-in is a session that shows its device and last activity; sign out one device or all the others. Signing out ends the session on the server.
- AI drafting for coding and SQL problems: Claude writes the problem, tests, reference solutions in C, Java and Python and starter code; expected outputs come from running the Python solution, then every solution is run against every test before the author sees the draft. SQL drafts come with a schema, sample rows and a model query that must return rows.
- Hindi: students can switch menus, buttons and messages to Hindi from their profile (questions and code stay in English, as in placement tests). The choice is saved on the account and remembered on the device for the sign-in page.

**Phase 7 additions**
- Campus placements (`/console/placements`): the placement cell imports academic records (CGPA, backlogs, class 10/12 marks, graduation year) and records each visiting company's drive with its eligibility rules, selection rounds, CTC and a mission to prepare with. Eligible students are told in the app (and on WhatsApp) and register from `/play/placements`; students who aren't eligible see exactly why. Staff move applicants through the rounds to offers in bulk, and students follow their progress. "Already placed" students are kept out of further drives unless a drive allows them (dream companies). Offers raise a `placement.offered` webhook.
- Placement outcomes: placement rate, offers and CTC (median, average, highest) by department and company, and the outcome proof the sales plan calls for: placement rate by how regularly students practised in the 60 days before they first applied, and selection rate by readiness on the day they applied. Both are snapshotted at registration, so later practice doesn't rewrite the "before" picture. CSV export per student.
- AI mock interviews (`/play/interview`): a short text interview with Claude as the interviewer, for service or product companies, leaning on the student's three weakest relevant skills. It follows up on vague answers, closes after at most eight answers, and writes a scorecard (problem solving, fundamentals, communication, code; strengths, improvements, skills to practise). Teachers see scores and transcripts for students in their scope (`/console/interviews`). One interview at a time, three a week, within the plan's AI allowance.
- Online invoice payment: institution admins pay issued invoices through a Razorpay payment link. The invoice is marked paid from Razorpay's signed webhook or the signed browser callback, whichever arrives first.
- Customer health (`/console/health`) for PlayCode staff and partners: per customer, students and seats, weekly active students and the trend against a month ago, answers per active student, staff using the console, assignments, AI tokens, licence end and overdue invoices, with a healthy / watch / at-risk call and its reasons. Partners see their own colleges.

**Phase 8 additions**
- Push notifications: students turn on notifications per device from their profile, and every reminder (streaks, assignments, tests, placement drives, announcements) also arrives as a phone or desktop notification from the installed web app. It is free to send, so it reaches students without WhatsApp. Tapping one opens the right page.
- Verified resume and public profile (`/play/resume`): a resume PDF built from the student's PlayCode record (readiness, mastered skills, certificates, coding practice, latest mock interview, academic record) plus their own headline, summary and links. Students choose whether readiness scores, the mock interview score and their marks appear, and can publish a public profile at `/p/<code>` for recruiters (never with email, roll number or marks); hiding it kills the link. Teachers download resumes from a student's page, and drive exports include the profile link where one is published.
- Billing emails: each new invoice is emailed with its PDF to the customer's accounts email and admins, with a reminder three days before it is due, weekly reminders while overdue (four at most), and licence-renewal reminders 60, 30 and 7 days before a licence ends.
- Reporting API for BI tools (scope `reports:read`): `GET /v1/reports/engagement/daily` (per day, overall or per section), `/v1/reports/skill-mastery`, `/v1/reports/readiness` and `/v1/reports/placements`, as JSON or CSV (`?format=csv`), with cursor paging. Power BI, Tableau, Looker Studio or Excel can pull them on a schedule.

**Phase 9 additions**
- Licence lifecycle: after a licence's end date there are 14 days of full access with a warning, then the account is read-only. People can still sign in, view and export their data, make privacy requests, change settings and pay invoices, but nothing can be practised or created, and integration writes are refused. A college under a partner also stops when the partner's licence does. Admins see a renewal banner 30 days ahead. PlayCode staff renew licences by months from customer health; partners renew their colleges up to their own end date.
- Question bank quality: the content team (or an institution's authors) imports up to 200 questions at a time as JSON; each is saved as a draft and checked as in the editor, and the ones that pass publish in one step. Students report a question from the player once they've answered it. Item analysis on first attempts (difficulty, upper-lower discrimination, and a strong-student favourite that isn't the keyed option) flags likely flaws. Flagged and reported questions make a review queue (`/console/studio/review`) where reports are resolved and questions edited or retired. Reports show the institution, never the student.
- GST credit notes: PlayCode staff correct an issued invoice with a numbered credit note (`PC/CN/2026-27/0001`) carrying the invoice's kind of tax, and can refund an online payment through Razorpay at the same time. Customers get it by email and on their billing page; payment links and reminders use the amount still due.
- Accessibility: an axe-core check (WCAG 2.1 A and AA) over 25 student and console screens, with the issues it found fixed (progress bar names, text contrast of status colours, faded text, link styling). Re-run it with `pnpm --filter @playcode/web a11y` against a running demo (`PW=$(npm root -g)/playwright` if Playwright is installed globally).

**Phase 10: production readiness**
- CI (GitHub Actions): dependency audit (fails on high or critical advisories), type checks, content verification by running every bundled question, core and API tests against Postgres, the web build, then a seeded demo started up for the accessibility check and a backup-and-restore round trip.
- Data retention (the DPDP Act's storage limitation): a nightly job deletes webcam snapshots a set number of days after their test closes (90 by default, 7 to 730 per institution under Settings), used or expired sign-in codes, sessions signed out or unused for 30 days, notifications after a year, push subscriptions unused for 180 days, and expired SAML, LTI and rate-limit leftovers. Learning records, results, certificates and the audit trail are kept.
- Monitoring: an `x-request-id` on every response (500 errors quote it), `/health` for liveness and `/health/ready` for the database and migrations, Prometheus metrics at `/metrics` (request counts and latency by route, job health, outbox backlogs) behind `METRICS_TOKEN`, and a System status page for PlayCode staff.
- Security: a Content Security Policy and other security headers on the web app, unframeable `nosniff` responses from the API, `no-store` on signed-in responses, rate limits on public lookups, and a clean dependency audit apart from one moderate advisory in a development tool (esbuild under drizzle-kit; its affected dev server isn't used).
- Backups: `ops/backup.sh` (compressed `pg_dump` plus local file storage, checksums, retention, optional upload command) and `ops/restore-check.sh`, which restores the newest backup into a temporary database and checks it.

**Phase 11 additions**
- Spaced review: every skill a student has started sits on a review ladder (2, 5, 12, 30, 60 and 120 days). Remembering a skill when it is due moves it up a step; a wrong answer moves it down one; practising early refreshes the due date without moving it up. Skills that are due (and were learned to at least 35% mastery) show as "fading" on the home screen and the learn map, and a review session interleaves two quick questions from each of up to five due skills, without costing hearts. Students with three or more fading skills get a reminder once a week (late afternoon).
- Spoken mock interviews: students can choose to speak their answers. The browser reads each question aloud and turns speech into text with the Web Speech API (Chrome and Edge use their speech service; Safari can work on the device), and the student can correct the words before sending. PlayCode stores only the text and how long the student spoke, never audio. Each spoken answer records pace and filler words, the scorecard adds delivery feedback (words a minute, fillers per 100 words, tips), the interviewer keeps questions short for listening, and the scorer ignores transcription errors. Teachers see which interviews and answers were spoken and whether the transcript was edited.
- SAML single logout and encrypted assertions: with a service-provider key pair (`SAML_SP_PRIVATE_KEY`, `SAML_SP_CERT`), PlayCode's metadata publishes signing and encryption certificates and a single logout service. Signing out of a SAML session sends a signed logout request to the IdP; a signed IdP logout request (redirect or POST binding) ends the PlayCode sessions it names (by NameID and SessionIndex) and is answered with a logout response. Unsigned logout requests are refused. Encrypted assertions are decrypted, and an institution can require them.

**Phase 12 additions**
- Talent pool: an institution opens it from Placements, and its students choose to join it from their profile (optionally naming up to five cities and the kinds of company they want). Companies on the Enterprise plan search the pool (`/console/talent`) by measured readiness for service or product roles, mastered skills, graduation year and location, open a student's verified profile (their marks only if the student shares them) and invite them to apply, optionally to one of their drives; at most 50 invitations a day. The student's email and phone go to the company only when the student accepts. A declined invitation blocks re-inviting for 90 days; unanswered ones lapse after 30. The placement cell sees which companies invited its students. Joining and leaving go in the consent ledger; invitations are in the data export, erased with the account and deleted after two years. Closing the pool, or a lapsed licence, hides a college's students at once.
- CS fundamentals: a "concept check" question type (plain multiple choice, no code) and 24 questions on DBMS (keys and normalisation, transactions), operating systems (scheduling, memory and deadlocks) and computer networks (layers and protocols, IP addressing), for the technical sections of service-company tests. The 13 with computable answers (scheduling averages, page faults, subnetting, candidate keys, a rolled-back transaction) are proved by running a program in `pnpm verify:content`. There is a CS fundamentals mission, the studio and AI drafting support the type, and readiness now weighs these topics: DBMS, OS and networks for service companies; DBMS and OS for product companies.
- Peer benchmarks: a nightly snapshot of each institution's median readiness, weekly active share and answers per active student. Institution-wide staff see "How you compare" on the overview: their value, the peer median and top quartile, and the share of peers they are ahead of (rounded down to tens). Only institutions with 20 or more students are measured, and comparisons appear only once 5 or more peers are, so no college can be identified.

**Phase 13 additions**
- Coding contests (`/console/contests`, `/play/contests`): a college runs a timed contest on coding and SQL problems for chosen batches (or everyone); PlayCode staff run inter-college ones for listed colleges, where students appear by first name and initial and each college sees full names only for its own students. Problems stay hidden until the start. Students submit as often as they like (6 a minute); every submission is judged on all tests and returns only the verdict and how many tests passed. Scoring follows ICPC: problems solved, then penalty minutes (time to each accepted solution plus 20 per rejected try, compile errors excepted). The students' scoreboard can freeze for the last minutes, showing later tries as pending until the end; staff always see it live. After the end, staff check accepted solutions for copied code (85% or more alike). Students are notified and see a live contest on the home screen.
- Study plans (`/play/plan`): a student picks a placement drive, or a date and a kind of company, and gets one task a day until then: practise the skill with the largest weighted gap to 70% mastery for that kind of company, review fading skills every seventh day, and a mission as a mock round the day before. Days tick off from real practice (a finished session on the day's skill, a finished review or the mission), today's task is on the home screen, and the plan can be rebuilt from today.
- Weekly insights: on the overview, staff can have this week's briefing written for their scope (the institution, a unit, or a teacher's own sections): a headline, observations marked going well, watch or act, and up to three suggested actions. The model sees only aggregates (activity this week and last, readiness bands, weakest skills, assignment completion, streaks), never a student's name or record. One briefing per scope per day, cached and metered against the plan's AI allowance (Pro and up).

**Phase 14 additions**
- Aptitude track: quantitative aptitude (percentages, profit and interest; time, speed and work; number system) and logical reasoning (series and odd one out; coding, directions and arrangements), 23 questions for the aptitude section of service-company tests. The 22 with computable answers are proved by a program in `pnpm verify:content`. There is an aptitude-round mission, and service readiness now weighs aptitude and reasoning.
- Contest ratings and certificates: when a contest ends, the hourly job publishes its results once: each participant's place, a contest rating change (multi-player Elo against everyone in the standings, starting at 1200; K 64 for the first five rated contests, then 32), a verifiable certificate for the top three who solved something, and a notification. The rating shows on the student's profile, resume (PDF too), public profile and in talent-pool search.
- Live classroom quizzes (`/console/live`, `/play/live`): a teacher builds a quiz from a mission or a skill (quick questions, 10 to 120 seconds each) and puts the host screen on the projector; students join on their phones with a 6-digit code. The server owns the timer and refuses late or repeated answers; a right answer scores 500 to 1000 points, more the faster it comes. The teacher reveals each answer (or the timer does) with the spread of answers and a leaderboard. Updates go over the realtime channel, with polling as a fallback. Quizzes are deleted after 90 days.
- Fix: the resume's "questions solved" now counts every quick question type (it was missing Parsons, trace, reverse-mode and pseudocode questions).

**Phase 15 additions**
- Execution workers: with `EXECUTION_MODE=queue`, API instances put code runs in a Postgres job queue and wait for the result; worker processes (`pnpm --filter @playcode/api worker`) claim jobs with `FOR UPDATE SKIP LOCKED`, tests and contests first, then duels, then practice. Student code then runs on machines sized and scaled apart from the API, and a burst of contest submissions queues instead of slowing every request. A job that throws is retried up to three times; a job whose worker died is put back after two minutes; finished jobs (they hold student code) are deleted after a day. Queue depth shows on System status and as `playcode_code_runs{state}` in metrics.
- Directory sync (SCIM 2.0, Enterprise): Microsoft Entra ID, Okta or Google keep student accounts in step with the college directory. Settings shows the tenant URL and makes a bearer token (shown once). New users become students in a chosen default batch, within the licence's seats; students added earlier by CSV are matched by email. Deactivating or deleting a user disables the account and signs it out at once (their history stays; erasure is still a privacy request). Groups are batches and sections matched by name; a new group becomes a batch, and students who leave every group go back to the default batch. Staff accounts stay in the console. Every change is in the audit log.
- Practice after contests: when a contest ends its problems stay open. Submissions are judged on every test as before but marked as practice, kept off the scoreboard, ratings and the copied-code check. Each problem shows its model solution and explanation, students see which problems they solved in practice, and staff see how many practised after.
- Accessibility: the contest scoreboard and the code editor can be focused and scrolled from the keyboard on phones.

**Phase 16 additions**
- Verbal ability track: grammar and sentence correction, vocabulary in context, and reading comprehension with sentence order, 21 questions for the English section of service-company tests. Each explanation names the rule or the line of the passage that decides the answer (language keys can't be proved by a program, except sentence order, which is). There is a verbal-ability mission, and service readiness now weighs verbal ability.
- Mock tests (`/play/mocks`, linked from Me): full timed tests on a service-company pattern (aptitude, reasoning, verbal, programming logic and one coding problem; 60 minutes) and a product-company pattern (CS fundamentals, programming concepts and two coding problems; 67 minutes). Sections run in order, each with its own timer, with no going back; the clock keeps running if the student leaves, and the hourly job marks papers that ran out. Questions come from PlayCode's own bank, favouring those the student hasn't seen in earlier mocks; five mocks a day at most. The report shows section scores against targets, a percentile against each student's latest attempt on the pattern (once 20 students have one), the skill to practise next with a one-tap session, and every answer with the correct one and its explanation. Staff see each student's mock scores on the student page.
- Catch-up assignments (Assignments → "Catch-up for struggling students", or "Catch-up work" next to a weak skill on the overview): choose skills, batches and a mastery level; PlayCode lists the students below it, staff untick any to leave out, and the practice goes to just them. The report shows average mastery when it was set and now, how many improved and how many reached the level. Reminders, reports, insights and completion counts only count the chosen students.

**Phase 17 additions**
- HR round in mock interviews: alongside the technical rounds, students can practise the behavioural round freshers are often weakest at (introducing themselves, teamwork, a failure, goals). The AI interviewer asks for real examples, follows up on the missing part of situation, task, action, result, and stays away from personal matters (religion, caste, marriage, family plans, health, salary). The scorecard rates structure, specific examples, communication and self-awareness, and lists questions to prepare a better story for. Staff see HR rounds averaged apart from technical ones; the resume still shows the latest technical round only.
- Offline practice (`/offline`, linked from Me): students download 15 quick questions on their weak skills and answer them with no signal. The page works from the service worker's copy, and any other page sends the student there while offline. The phone gets questions, never answers; they are marked when the pack syncs, through the same path as any practice (mastery, XP, mistakes, streak). The home page reminds students of answers waiting to be checked.
- Study squads (`/play/squad`): up to six classmates share a weekly goal of answers (50 to 300), keep a streak of weeks they hit it, and can nudge a squadmate who hasn't practised today (once a day each). Squadmates see each other's answers and streaks, not scores or mastery. The hourly job tells a squad when it reaches its goal, and on Friday evening when it's under 60% with the weekend left.
- Accessibility: read-only code blocks can be focused and scrolled from the keyboard.

**Phase 18 additions**
- Doubts: after answering a question, a student can ask their teachers about it ("Still confused? Ask your teachers"). The doubt goes to staff whose scope includes the student (a new `doubts.answer` permission for faculty, HODs, TPOs and institution admins), on a console queue that shows the question, the correct answer, the explanation and what the student answered. The answer comes back as a notification and on the student's doubts page. A teacher can share an answer: the institution's other students then see the doubt and its answer, without names, once they have answered that question themselves.
- AI code review: once a solution passes every test in practice, the student can ask for the debrief an interviewer would give: time and space complexity, a better approach if there is one, edge cases to think about, readability points and a cleaner version in the same language. It uses the AI coach's plan feature and institution switch; each accepted answer is reviewed once and kept (at most 10 reviews a day).
- Mock interviews with people (`/play/panel`, console Interview slots): the placement cell publishes runs of back-to-back slots for chosen batches with a faculty member or an alumnus (who needs no account), students book one at a time and can cancel up to two hours before, the hourly job reminds them the day before, and the interviewer's rubric (communication, technical knowledge, problem solving, confidence, an overall score and a recommendation) comes back to the student. Missed interviews can be marked as such.
- Accessibility: the code editor's colours for names and comments now meet WCAG AA contrast.

**Institution console** (`/console`, desktop)
- Overview: weekly active students, daily activity chart, readiness distribution, weakest skills, at-risk list, streak distribution, mastery for every skill. Filter by department, batch or section.
- Students: sortable list with readiness, CSV export, and a full student view.
- Assignments: build from skills or a mission pack, target any batches or sections, completion tracking and question-by-question analysis.
- Batches: department, batch and section tree; bulk student import from CSV with seat-limit checks.
- Question bank browser with answers, explanations and live accuracy.

**Platform**
- Roles: super admin, content manager, partner admin, institution admin, TPO, HOD, faculty, proctor, student. HODs see their department; faculty see their own sections.
- Multi-tenant data model; tenant onboarding API for the super admin.
- Starter content: 50 questions in C, Java, Python and pseudocode across 17 skills, and 4 mission packs. Every question with runnable code is executed by `pnpm verify:content` to prove its stated answer.

## Repository layout

```
packages/core   Pure domain logic: question types and grading, XP, levels, streaks,
                hearts, leagues, Elo-style mastery, readiness score, badges, roles.
apps/api        Fastify + Drizzle ORM on PostgreSQL. Routes: /auth, /student, /console, /admin,
                /public, /privacy, the public API under /v1 and SCIM under /scim/v2.
                `pnpm worker` runs code from the execution queue.
apps/web        Next.js 15 (App Router) PWA: /play for students, /console for staff.
```

## Run it locally

Requirements: Node 22, pnpm 10, PostgreSQL 16 (or Docker).

```bash
pnpm install
docker compose up -d postgres          # or use a local PostgreSQL with user/password playcode
cp apps/api/.env.example apps/api/.env  # optional; defaults match docker-compose
pnpm --filter @playcode/api db:reset    # migrate and load the demo institution
pnpm dev:api                            # http://localhost:4000
pnpm dev:web                            # http://localhost:3000
```

The demo seed creates "Demo Institute of Technology" with 31 students and two
weeks of simulated practice, on the Enterprise plan so every feature is on. It includes a placement season (TCS, Infosys and Zoho drives with results; Accenture and Freshworks open now) and one finished mock interview for the demo student. Every account's password is `playcode123`.

| Role | Email |
| --- | --- |
| Student | student@demo.edu |
| Faculty (CSE 2027 - A) | faculty@demo.edu |
| HOD (Computer Science) | hod.cse@demo.edu |
| TPO | tpo@demo.edu |
| Institution admin | admin@demo.edu |
| Platform super admin | superadmin@playcode.dev |
| Training partner admin (SkillBridge) | partner@skillbridge.in |
| Partner's college admin (Sunrise, sign in at `/login?org=sunrise`) | admin@sunrise.edu |
| Partner's college student | sunrise.student1@sunrise.edu |
| Company HR admin (Acme) | hr@acme.dev |
| Company recruiter (Acme) | recruiter@acme.dev |

The demo institution also has a pending deletion request (Privacy requests in the console).

Set `NEXT_PUBLIC_DEMO_LOGINS=false` to hide the demo buttons on the sign-in page.

## Tests

```bash
pnpm typecheck
pnpm test             # core unit tests, API integration tests, content verification
pnpm verify:content   # run every question's code and check the stated answer
```

API tests run in parallel, each worker on its own throwaway database. They connect with
`postgres://playcode:playcode@localhost:5432/playcode_test` (override with `TEST_DATABASE_URL`);
the database name is only a prefix, and a run creates `playcode_test_r<pid>_1` to `_4` and drops
them when it ends, so the user needs `CREATEDB` (the Docker and CI user has it). `TEST_WORKERS`
sets the number of workers (default 4). Databases left by a run that crashed are dropped the next time.

## Operations

Scheduled jobs (run them from cron or your scheduler):

| Job | When | Command |
| --- | --- | --- |
| Close league week | Mondays after midnight, tenant time | `pnpm --filter @playcode/api league:close` |
| Nudges, notification delivery (in-app, push, WhatsApp), missed snapshot reviews, weekly report emails, billing emails, contest results and ratings, marking mock tests that ran out, squad goal reminders, reminders for booked mock interviews | Hourly (streak reminders only fire 6-9 pm local time, fading-skill reminders 4-6 pm and at most weekly) | `pnpm --filter @playcode/api nudges:run` |
| Webhook and LMS grade retries | Every minute | `pnpm --filter @playcode/api webhooks:deliver` |
| Data retention clean-up | Nightly | `pnpm --filter @playcode/api retention:run` |
| Peer benchmark snapshots | Nightly | `pnpm --filter @playcode/api benchmarks:run` |
| Database and file backup | Nightly, after the clean-up | `ops/backup.sh`, then `ops/restore-check.sh` |

Every job records its runs in `job_runs`; PlayCode staff see them under System status, and a job that fails or hasn't succeeded for twice its interval shows as needing attention (and as `playcode_job_healthy 0` in metrics). Each script exits non-zero on failure, so cron or your scheduler can alert too.

Webhooks are sent straight away when an event happens; the job retries failures
(1, 2, 4, 8, 16 then 32 minutes apart, 7 attempts in all) and picks up anything a crash left behind.

Code execution:
- Development and tests use the local runner (`EXECUTION_BACKEND=local`), which needs `gcc`, `javac`/`java` and `python3` and limits CPU, memory and output with `prlimit`. It does not isolate the network or filesystem, so the API refuses it in production.
- Production: run [Judge0](https://github.com/judge0/judge0) on its own network and set `EXECUTION_BACKEND=judge0` and `JUDGE0_URL`. Assessments get priority over duels and practice in the execution queue.
- Where the code runs: by default (`EXECUTION_MODE=inline`) each API instance runs code itself, `EXECUTION_CONCURRENCY` at a time. With `EXECUTION_MODE=queue`, the API only queues runs, and you run one or more workers with `pnpm --filter @playcode/api worker` (same environment as the API; each runs `EXECUTION_CONCURRENCY` jobs at a time and stops cleanly on SIGTERM, finishing what it has started). Run at least one worker whenever the API is in queue mode: a run nobody picks up within 60 seconds is withdrawn and the student is asked to try again. Workers can use the local runner inside a locked-down container, or call Judge0.

WhatsApp nudges: set `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID` (WhatsApp Cloud API) and create approved templates named `playcode_streak_at_risk`, `playcode_assignment_due`, `playcode_test_open`, `playcode_duel_invite`, `playcode_announcement`, `playcode_placement`, `playcode_review_due`, `playcode_talent_invite`, `playcode_contest`, `playcode_squad`, `playcode_doubt` and `playcode_interview_slot`, each with two body parameters (title, message). Students add their number on their profile or through the CSV import (fourth column).

Single sign-on: set `API_PUBLIC_URL` to the address browsers use for the API, and register `<API_PUBLIC_URL>/auth/sso/callback` as the redirect URI in Google Cloud or Microsoft Entra. The institution admin then enters the client ID and secret under Settings. Students sign in from `/login?org=<slug>`.

Secrets: webhook signing keys and SSO client secrets are encrypted with `DATA_KEY` (AES-256-GCM). Set it in production; without it a key is derived from `JWT_SECRET`, so rotating that secret would make stored secrets unreadable.

Outbound URLs: webhook targets and SSO issuers on private networks (localhost, 10.x, 192.168.x, cloud metadata) are refused. `ALLOW_PRIVATE_URLS=true` lifts this for development and tests only; the API refuses it in production.

Data erasure: approving a deletion request removes the student's practice history, answers, test attempts with proctoring snapshots, certificates, notifications and hiring-drive records, and anonymises the account (the row stays so cohort totals add up). The consent ledger, the request and the audit trail (with email addresses removed) are kept as the record.

AI features: set `ANTHROPIC_API_KEY` on the API. They use Claude Opus 5.5 (`AI_MODEL` in `apps/api/src/lib/ai.ts`) with server-side refusal fallback; without a key the coach, AI drafting and snapshot review are simply hidden. `AI_ENABLED=false` switches them off for the whole server, and each institution can turn the coach and the snapshot review off under Settings. Token use is recorded per institution in the `ai_usage` table. Snapshot review is the costly one: a strict test takes a photo a minute, so a 60-minute test means about 60 reviews per student.

LMS (LTI 1.3): the institution admin registers the LMS under Settings (Moodle and Canvas URLs are filled in from presets) and gives the LMS admin the tool's login, launch and JWKS URLs shown there. In the LMS, enable "Assignment and Grade Services", share name and email, and open the tool in a new window (browsers block sign-in storage inside cross-site iframes). A teacher's first launch of a new activity asks which assignment it opens; alternatively set the custom parameter `assignment_id=<id>`. Students launching must be in a batch the assignment targets. Teachers can also add activities from the LMS's content picker (deep linking): they choose assignments in PlayCode and the LMS creates the activities and gradebook columns.

SAML: under Settings, paste the identity provider's metadata (or enter its entity ID, redirect SSO URL and signing certificate) and give the IdP admin PlayCode's SP metadata URL shown there. Assertions must be signed; the email comes from the NameID (email format) or a named attribute. When SAML is on, the sign-in button uses it instead of OpenID Connect. For single logout and encrypted assertions, give the server a key pair (`openssl req -x509 -newkey rsa:2048 -nodes -days 1095 -subj "/CN=PlayCode SAML" -keyout sp.key -out sp.crt`, then set `SAML_SP_PRIVATE_KEY` and `SAML_SP_CERT`); the SP metadata then carries the certificate and logout URL, and the settings take the IdP's single logout URL (read from its metadata) and an option to require encrypted assertions. Rotating the key means sending IdP admins the new metadata.

Directory sync (SCIM): the institution admin connects it under Settings, which shows the tenant URL (`<API_PUBLIC_URL>/scim/v2`) and makes the secret token, then chooses the batch new students join. In Entra ID, add PlayCode as an enterprise application, set provisioning to Automatic with that URL and token, and keep the default user mapping (`userName` must be the student's email); if your directory holds roll numbers, map them to the enterprise `employeeNumber` attribute. Okta's SCIM 2.0 app works the same way with "Push groups" for batches. Making a new token stops the old one at once. Supported: Users and Groups with `eq` filters on `userName`, `externalId` and `displayName`, PATCH, and paging; bulk operations and sorting are not. When a licence has ended, the IdP can still switch accounts off but can't add new ones.

Email: set `SMTP_URL` (for example `smtps://user:pass@smtp.example.com:465`) and `MAIL_FROM` for the weekly report emails. Without it, reports can still be downloaded.

Plans and billing: set the plan for each customer under Admin when creating or editing a tenant (colleges under a partner are billed through the partner, so only top-level customers get invoices). Prices, AI allowances and the features of each plan are in `packages/core/src/plans.ts`. Invoices use the supplier details in `BILLING_LEGAL_NAME`, `BILLING_GSTIN`, `BILLING_ADDRESS` and `BILLING_STATE_CODE` (two-digit GST state code; customers in the same state get CGST and SGST, the rest IGST). Issue a month's invoices from Invoicing in the console after the month ends; re-running skips customers already invoiced. Payment collection is not built: mark invoices paid by hand.

Sign-in codes go by email when `SMTP_URL` is set and by WhatsApp when WhatsApp is configured and the account has a phone number; without either, the option is hidden. For WhatsApp, create an Authentication template named `playcode_login_code` with a copy-code button. Two-factor secrets are encrypted with `DATA_KEY`; recovery codes are stored hashed.

Online payments (Razorpay): set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`, and in the Razorpay dashboard add a webhook to `<API_PUBLIC_URL>/webhooks/razorpay` for the `payment_link.paid` event with a secret, set as `RAZORPAY_WEBHOOK_SECRET`. Razorpay returns payers to `<PUBLIC_APP_URL>/console/billing/paid`. A payment only settles an invoice when the amount matches the invoice total; other amounts are logged in the audit trail for follow-up. Without the keys, invoices show bank-transfer details only.

Placements: academic records come from the placement cell's CSV (roll number or email, CGPA, backlogs, class 10 %, class 12 %, graduation year). A student's eligibility is checked when they register, against the record at that moment. The outcome comparison is a correlation, and the page says so: students who practise more may also be keener in other ways.

Mock interviews use the same Claude setup as the other AI features and count against the plan's AI allowance. Each interview is about 10 requests (one per answer plus the opening question and the scorecard).

Push notifications: generate keys once with `npx web-push generate-vapid-keys` and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` address). Notifications go out with the rest of the outbox (the hourly job, and straight after announcements). The site must be served over HTTPS. On iPhone, students first add PlayCode to the home screen. Without the keys, the option is hidden.

Billing emails need `SMTP_URL`; they go out from the hourly job and are recorded in `billing_notices`, so each is sent once. Licence end dates are reminders only: nothing is locked when a licence ends.

Reporting API: create an API client with the "Reporting for BI tools" scope under Integrations. Engagement days follow the institution's time zone; readiness is as of the request; placement rows carry the readiness and practice snapshot taken when the student registered.

Licences: a tenant's end date is `valid_until`; leave it empty for no end date. Read-only starts the day after the 14-day grace period, in the institution's time zone. Partners can't renew a college beyond their own end date.

Question import format: a JSON array of questions as the studio editor saves them (see the example on the import page). Item analysis needs at least 30 first attempts per question in the last 180 days before it judges difficulty or discrimination.

Credit notes: issued from Invoicing in the console. A credit note can't exceed what is left to credit on the invoice. With "refund", the Razorpay refund is made first; if Razorpay refuses, no credit note is recorded.

Monitoring: point your uptime checker at `/health/ready` (503 until the database is reachable and migrated) and Prometheus at `/metrics` with `Authorization: Bearer <METRICS_TOKEN>`; scrape every API instance, since request metrics are per instance. Useful alerts: `playcode_job_healthy == 0`, `playcode_outbox_pending` growing for an hour, and `playcode_webhook_deliveries_failed` increasing. Set `APP_VERSION` to show the deployed version on the status page.

Backups: run `DATABASE_URL=... BACKUP_DIR=/var/backups/playcode STORAGE_DIR=... ops/backup.sh` nightly and copy the files off the server (`BACKUP_UPLOAD_CMD` receives the file paths). Run `ADMIN_DATABASE_URL=postgres://.../postgres ops/restore-check.sh` after each backup or at least weekly; it needs a role that can create databases. Restore for real with `pg_restore --clean --no-owner --dbname=$DATABASE_URL <file>.dump`, then untar the storage archive into `STORAGE_DIR`.

Security headers: the web app's Content Security Policy allows network calls to `NEXT_PUBLIC_API_URL` only, so set it at build time to the API's public address. Next's inline bootstrap needs `'unsafe-inline'` for scripts; moving to per-request nonces is the next step if you need a stricter policy.

Running several API instances: put them behind a load balancer (WebSocket upgrades must be allowed); they share Postgres for live events (each instance keeps one extra LISTEN connection), rate limits, webhook and grade outboxes and SAML request ids. Run the scheduled jobs from one place only. In the default inline mode the code-execution queue limits concurrency per instance, so size `EXECUTION_CONCURRENCY` per instance against your Judge0 capacity; in queue mode, size the worker pool instead. `REALTIME_FANOUT=off` keeps live events within one instance.

Other operations:

- Weekly league close: run `pnpm --filter @playcode/api league:close` every Monday after midnight (tenant time), or call `POST /admin/leagues/close-week`. Re-running is safe.
- Schema changes: edit `apps/api/src/db/schema.ts`, then `pnpm --filter @playcode/api db:generate` and commit the migration in `apps/api/drizzle`.
- Content updates: edit `apps/api/src/content/*`, run `pnpm verify:content`, then `pnpm db:seed` (content upserts keep calibration data and bump the question version).

## Choices that differ from the spec, and what comes next

- **Fastify instead of NestJS**: lighter for a modular monolith of this size; modules live in `apps/api/src/routes` and `services`.
- **Leaderboards from PostgreSQL**, no Redis yet: group sizes are 30, so queries stay cheap. Add Redis with realtime duels.
- **Password, sign-in code, OpenID Connect or SAML sign-in, with optional TOTP for staff**: imported students get a starting password from the import screen and can use sign-in codes from then on. Two-factor is for staff accounts; students are not asked for it.
- **Tenant isolation in the API layer**: every query is scoped by tenant and org unit. PostgreSQL row-level security was considered and left out: it needs every request wrapped in a transaction that sets the tenant, which touches every route for little gain over the scoped queries and tests already in place.
- **Mock interviews are text, not voice**: typed answers keep the cost and the setup low and work on any phone; voice could come later on the same transcript format.
- **Placement outcomes are correlations**: the report compares practice and readiness before applying with results, which is the evidence colleges ask for, but it cannot separate practice from motivation.
- **Hindi through a small dictionary** keyed on the English text, not a translation platform: untranslated strings fall back to English, so screens can be translated one at a time. The console stays in English.

- **Postgres instead of Redis for cross-instance state**: live events, rate limits and outboxes all use Postgres, so there is one less service to run. At very high event volume, move the fan-out to Redis pub/sub behind the same `publish()`.
- **Camera checks are snapshots, reviewed by AI at level 3**: there is no continuous video or in-browser face tracking.

- **Sessions are checked against the account and its device session on every request**, so disabling or erasing an account, or signing a device out, takes effect at once. This costs one indexed lookup per request.

- **Spoken interviews use the browser's speech recognition**, not a speech API of our own: there is no audio upload, storage or extra cost, and it works on most Android phones (Chrome). The trade-off is that Firefox can't do it (students type there) and pace is measured from microphone time, which includes pauses.
- **Spaced review works per skill, not per question**: placement tests sample a skill rather than repeat a question, and a skill-level ladder keeps the review queue short enough to clear in minutes.
- **Live quizzes don't feed mastery or XP**: classroom answers are timed and social (a neighbour can see a phone), so they're kept out of the measured record that readiness, the resume and the talent pool rely on.
- **Contest submissions are judged at test priority**, like proctored tests. For large inter-college contests, use queue mode with workers (and Judge0) so judging scales separately from the API.
- **The execution queue is a Postgres table**, not a message broker: jobs are small and short-lived, `SKIP LOCKED` gives each worker its own job, and LISTEN/NOTIFY wakes the waiting request, so there is still no extra service to run. A broker becomes worth it only well beyond what one Postgres handles.
- **SCIM deactivates rather than deletes**: a DELETE from the identity provider disables the account and keeps the student's record, because practice history, test attempts and placements are the institution's records too. Deleting a group empties it but keeps the batch, which assignments and reports still point to. Erasure stays a privacy request.
- **Weekly insights send aggregates only to the AI**: names, roll numbers and individual records stay in PlayCode, so the briefing can't single out a student; the overview's lists remain the place to find who needs help.
- **The talent pool is opt-in twice**: the institution opens it and each student joins it. Companies search what PlayCode measured rather than self-reported claims, and contact details follow the student's acceptance of a specific invitation, which is the consent the DPDP Act asks for.
- **Readiness now counts CS fundamentals**: students who haven't practised DBMS, OS or networks see their readiness drop when this ships, because those topics count as not yet shown. That is accurate for service-company tests, but worth telling institutions about before it lands.
- **Readiness now counts verbal ability** for service companies: as with CS fundamentals, students who haven't practised it will see their service readiness drop when this ships, so tell institutions first.
- **Mock tests don't change mastery or XP**: they are a measurement, taken unproctored at home, so they inform the student and staff without feeding the record that readiness, the resume and the talent pool rely on. Percentiles compare each student's latest attempt, not their best, so retaking until lucky doesn't inflate the comparison.
- **Offline answers are marked on the server, not the phone**: putting answer keys on the device would let anyone read them and inflate the record that readiness, the resume and the talent pool rely on, so students wait for the sync to see what they got right. Each answer counts on the day it was given (clamped between the pack's download and the sync), unless that is before the student's latest practice day or in an earlier league week; then it counts at the sync, so a late sync can't reset a streak or change a closed league week. A phone with a wrong clock can at most move an answer within that window.
- **Shared doubt answers appear only after the student has answered the question**: an answer to a doubt often explains the solution, so showing it beforehand would give the answer away; the student's own attempt comes first, as with explanations.
- **Panel interviewers don't need accounts**: most alumni won't sign up for a one-off mock interview, so the slot carries the interviewer's name and the placement cell records the feedback for them.
- **The service worker caches only build assets and the offline page**: everything else, including all API calls, always goes to the network, so a cached page can never show stale marks or another student's data.
- **The HR round is not scored on English fluency**: the scorecard is told to judge clarity and substance, not accent or grammar slips, because the round is practice for first-generation and vernacular-medium students as much as anyone.
- **Catch-up assignments leave out students who never tried the skills** unless staff tick the option: a student with no attempts isn't struggling with the skill, they haven't started, and they usually need a different nudge.
- **The SAML key pair is one per server**, from the environment, rather than one per institution: IdPs only need PlayCode's certificate, and rotating it is a deploy, not a per-college task.

Not built yet: screen-reader testing by people who use them (the automated check covers WCAG rules it can test), PostgreSQL row-level security, languages other than English and Hindi, and native mobile apps (the web app is an installable PWA).
