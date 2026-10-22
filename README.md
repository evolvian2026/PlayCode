# PlayCode

Gamified coding practice and placement readiness, sold to institutions (B2B).
Coding is broken into short, aptitude-style questions (predict the output, spot
the bug, reorder the lines and more), wrapped in XP, streaks, hearts, leagues
and missions. Colleges get assignments, analytics and a readiness score per
student.

This covers Phases 1 to 3 of the product and architecture spec, plus Phase 4, which closes the roadmap items they left open.

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
weeks of simulated practice. Every account's password is `playcode123`.

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
| Nudges, notification delivery, missed snapshot reviews | Hourly (streak reminders only fire 6-9 pm local time) | `pnpm --filter @playcode/api nudges:run` |
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

LMS (LTI 1.3): the institution admin registers the LMS under Settings (Moodle and Canvas URLs are filled in from presets) and gives the LMS admin the tool's login, launch and JWKS URLs shown there. In the LMS, enable "Assignment and Grade Services", share name and email, and open the tool in a new window (browsers block sign-in storage inside cross-site iframes). A teacher's first launch of a new activity asks which assignment it opens; alternatively set the custom parameter `assignment_id=<id>`. Students launching must be in a batch the assignment targets. PlayCode supports resource-link launches; deep linking (choosing content from the LMS) is not built.

Other operations:

- Weekly league close: run `pnpm --filter @playcode/api league:close` every Monday after midnight (tenant time), or call `POST /admin/leagues/close-week`. Re-running is safe.
- Schema changes: edit `apps/api/src/db/schema.ts`, then `pnpm --filter @playcode/api db:generate` and commit the migration in `apps/api/drizzle`.
- Content updates: edit `apps/api/src/content/*`, run `pnpm verify:content`, then `pnpm db:seed` (content upserts keep calibration data and bump the question version).

## Choices that differ from the spec, and what comes next

- **Fastify instead of NestJS**: lighter for a modular monolith of this size; modules live in `apps/api/src/routes` and `services`.
- **Leaderboards from PostgreSQL**, no Redis yet: group sizes are 30, so queries stay cheap. Add Redis with realtime duels.
- **Email and password sign-in, plus OpenID Connect SSO**: SAML and OTP are not built. Imported students get a starting password from the import screen.
- **Tenant isolation in the API layer**: every query is scoped by tenant and org unit. PostgreSQL row-level security is the next hardening step.

- **Single API instance assumed for live features**: the WebSocket hub and the execution queue are in-process. Running several API instances needs Redis pub/sub and a shared job queue (BullMQ/SQS).
- **Camera checks are snapshots, reviewed by AI at level 3**: there is no continuous video or in-browser face tracking.

- **Sessions are checked against the account on every request**, so disabling or erasing an account signs it out at once. This costs one primary-key lookup per request.

Not built yet: SAML, LTI deep linking, corporate learning and development (L&D) paths, scheduled PDF reports, and AI drafting of coding and SQL problems (these are written by hand in the studio).
