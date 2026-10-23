# PlayCode

Gamified coding practice and placement readiness, sold to institutions (B2B).
Coding is broken into short, aptitude-style questions (predict the output, spot
the bug, reorder the lines and more), wrapped in XP, streaks, hearts, leagues
and missions. Colleges get assignments, analytics and a readiness score per
student.

This covers Phases 1 to 3 of the product and architecture spec, Phase 4 (which closes the roadmap items they left open) and Phase 5 (enterprise readiness and scale).

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
                /public, /privacy and the public API under /v1.
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

API tests need a PostgreSQL database they can wipe; they default to
`postgres://playcode:playcode@localhost:5432/playcode_test` (override with `TEST_DATABASE_URL`).
With Docker, create it once: `docker compose exec postgres createdb -U playcode playcode_test`.

## Operations

Scheduled jobs (run them from cron or your scheduler):

| Job | When | Command |
| --- | --- | --- |
| Close league week | Mondays after midnight, tenant time | `pnpm --filter @playcode/api league:close` |
| Nudges, notification delivery (in-app, push, WhatsApp), missed snapshot reviews, weekly report emails, billing emails | Hourly (streak reminders only fire 6-9 pm local time) | `pnpm --filter @playcode/api nudges:run` |
| Webhook and LMS grade retries | Every minute | `pnpm --filter @playcode/api webhooks:deliver` |

Webhooks are sent straight away when an event happens; the job retries failures
(1, 2, 4, 8, 16 then 32 minutes apart, 7 attempts in all) and picks up anything a crash left behind.

Code execution:
- Development and tests use the local runner (`EXECUTION_BACKEND=local`), which needs `gcc`, `javac`/`java` and `python3` and limits CPU, memory and output with `prlimit`. It does not isolate the network or filesystem, so the API refuses it in production.
- Production: run [Judge0](https://github.com/judge0/judge0) on its own network and set `EXECUTION_BACKEND=judge0` and `JUDGE0_URL`. Assessments get priority over duels and practice in the execution queue.

WhatsApp nudges: set `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID` (WhatsApp Cloud API) and create approved templates named `playcode_streak_at_risk`, `playcode_assignment_due`, `playcode_test_open`, `playcode_duel_invite` and `playcode_announcement`, each with two body parameters (title, message). Students add their number on their profile or through the CSV import (fourth column).

Single sign-on: set `API_PUBLIC_URL` to the address browsers use for the API, and register `<API_PUBLIC_URL>/auth/sso/callback` as the redirect URI in Google Cloud or Microsoft Entra. The institution admin then enters the client ID and secret under Settings. Students sign in from `/login?org=<slug>`.

Secrets: webhook signing keys and SSO client secrets are encrypted with `DATA_KEY` (AES-256-GCM). Set it in production; without it a key is derived from `JWT_SECRET`, so rotating that secret would make stored secrets unreadable.

Outbound URLs: webhook targets and SSO issuers on private networks (localhost, 10.x, 192.168.x, cloud metadata) are refused. `ALLOW_PRIVATE_URLS=true` lifts this for development and tests only; the API refuses it in production.

Data erasure: approving a deletion request removes the student's practice history, answers, test attempts with proctoring snapshots, certificates, notifications and hiring-drive records, and anonymises the account (the row stays so cohort totals add up). The consent ledger, the request and the audit trail (with email addresses removed) are kept as the record.

AI features: set `ANTHROPIC_API_KEY` on the API. They use Claude Opus 5.5 (`AI_MODEL` in `apps/api/src/lib/ai.ts`) with server-side refusal fallback; without a key the coach, AI drafting and snapshot review are simply hidden. `AI_ENABLED=false` switches them off for the whole server, and each institution can turn the coach and the snapshot review off under Settings. Token use is recorded per institution in the `ai_usage` table. Snapshot review is the costly one: a strict test takes a photo a minute, so a 60-minute test means about 60 reviews per student.

LMS (LTI 1.3): the institution admin registers the LMS under Settings (Moodle and Canvas URLs are filled in from presets) and gives the LMS admin the tool's login, launch and JWKS URLs shown there. In the LMS, enable "Assignment and Grade Services", share name and email, and open the tool in a new window (browsers block sign-in storage inside cross-site iframes). A teacher's first launch of a new activity asks which assignment it opens; alternatively set the custom parameter `assignment_id=<id>`. Students launching must be in a batch the assignment targets. Teachers can also add activities from the LMS's content picker (deep linking): they choose assignments in PlayCode and the LMS creates the activities and gradebook columns.

SAML: under Settings, paste the identity provider's metadata (or enter its entity ID, redirect SSO URL and signing certificate) and give the IdP admin PlayCode's SP metadata URL shown there. Assertions must be signed; the email comes from the NameID (email format) or a named attribute. When SAML is on, the sign-in button uses it instead of OpenID Connect.

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

Running several API instances: put them behind a load balancer (WebSocket upgrades must be allowed); they share Postgres for live events (each instance keeps one extra LISTEN connection), rate limits, webhook and grade outboxes and SAML request ids. Run the scheduled jobs from one place only. The code-execution queue limits concurrency per instance, so size `EXECUTION_CONCURRENCY` per instance against your Judge0 capacity. `REALTIME_FANOUT=off` keeps live events within one instance.

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

Not built yet: voice mock interviews, screen-reader testing by people who use them (the automated check covers WCAG rules it can test), SAML single logout and encrypted assertions, PostgreSQL row-level security, languages other than English and Hindi, and native mobile apps (the web app is an installable PWA).
