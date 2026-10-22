# PlayCode

Gamified coding practice and placement readiness, sold to institutions (B2B).
Coding is broken into short, aptitude-style questions (predict the output, spot
the bug, reorder the lines and more), wrapped in XP, streaks, hearts, leagues
and missions. Colleges get assignments, analytics and a readiness score per
student.

This is the Phase 1 (MVP) build from the product and architecture spec.

## What is in this build

**Student app** (`/play`, mobile first)
- Home: daily challenge (the same 5 questions for the whole institution each day), assigned work, a suggested skill, league position, mistakes to review.
- Learn map: topics and skills with mastery bars; 8-question practice sets that cost a heart per wrong answer.
- Question player for all nine no-execution question types: predict the output, spot the bug, fill in the blank, reorder lines (Parsons), which snippet, complexity, trace the variable, reverse mode, pseudocode. Hints cost XP; every answer gets an explanation.
- Missions: company-pattern rounds with a pass mark.
- Weekly leagues (Bronze to Diamond, groups of 30, promotion and demotion zones), streaks with monthly freezes, hearts that refill over time or by fixing a past mistake, levels and badges.
- Profile: placement readiness (service and product company profiles), skill mastery, badges, mistake notebook.

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
apps/api        Fastify + Drizzle ORM on PostgreSQL. Routes: /auth, /student, /console, /admin.
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

- Weekly league close: run `pnpm --filter @playcode/api league:close` every Monday after midnight (tenant time), or call `POST /admin/leagues/close-week`. Re-running is safe.
- Schema changes: edit `apps/api/src/db/schema.ts`, then `pnpm --filter @playcode/api db:generate` and commit the migration in `apps/api/drizzle`.
- Content updates: edit `apps/api/src/content/*`, run `pnpm verify:content`, then `pnpm db:seed` (content upserts keep calibration data and bump the question version).

## Choices that differ from the spec, and what comes next

- **Fastify instead of NestJS**: lighter for a modular monolith of this size; modules live in `apps/api/src/routes` and `services`.
- **Leaderboards from PostgreSQL**, no Redis yet: group sizes are 30, so queries stay cheap. Add Redis with realtime duels.
- **Email and password sign-in**: OTP and SSO are next. Imported students get a starting password from the import screen.
- **Tenant isolation in the API layer**: every query is scoped by tenant and org unit. PostgreSQL row-level security is the next hardening step.

Phase 2 items not built yet: live coding with a sandbox (Judge0), 1v1 duels, proctored assessments, WhatsApp nudges, SSO, scheduled reports, and the content studio UI.
