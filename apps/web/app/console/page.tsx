"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActivityChart } from "@/components/ActivityChart";
import { Benchmarks } from "@/components/Benchmarks";
import { InsightsCard } from "@/components/Insights";
import { useMe } from "@/components/Auth";
import { UnitPicker } from "@/components/UnitPicker";
import { Bar, ErrorBox, Loading, masteryTone, Stat } from "@/components/ui";
import { useApi } from "@/lib/api";

interface Engagement {
  timeZone: string;
  totalStudents: number;
  activeLast7Days: number;
  weeklyActivePct: number;
  answersLast7Days: number;
  answersPerActiveStudent: number;
  daily: { day: string; activeStudents: number; answers: number }[];
  streaks: { label: string; students: number }[];
}
interface Skills {
  skills: { skillId: string; name: string; topicName: string; avgMastery: number; attemptedPct: number; accuracyPct: number | null }[];
  weakest: { skillId: string; name: string; topicName: string; avgMastery: number; attemptedPct: number }[];
}
interface Readiness {
  profiles: { id: string; name: string; average: number; bands: { ready: number; almost: number; building: number; at_risk: number } }[];
  atRisk: { id: string; name: string; rollNo: string | null; service: number; product: number }[];
}

const BANDS = [
  { key: "ready", label: "Ready (70+)", color: "var(--good-ink)" },
  { key: "almost", label: "Almost (50-69)", color: "var(--accent)" },
  { key: "building", label: "Building (30-49)", color: "var(--warn-ink)" },
  { key: "at_risk", label: "At risk (<30)", color: "var(--bad-ink)" },
] as const;

export default function Overview() {
  const me = useMe();
  const router = useRouter();
  // Partners manage colleges and companies hire; neither starts on student analytics.
  const landing = me.tenant?.type === "partner" ? "/console/partner" : me.tenant?.type === "company" ? "/console/drives" : null;
  useEffect(() => {
    if (landing) router.replace(landing);
  }, [landing, router]);
  const [unitId, setUnitId] = useState("");
  const q = unitId ? `?unitId=${unitId}` : "";
  const eng = useApi<Engagement>(`/console/analytics/engagement${q}`);
  const skills = useApi<Skills>(`/console/analytics/skills${q}`);
  const readiness = useApi<Readiness>(`/console/analytics/readiness${q}`);

  const err = eng.error ?? skills.error ?? readiness.error;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>Overview</h1>
          <p className="muted" style={{ margin: 0 }}>
            {me.tenant?.name} · who is practising, who is ready, who needs help
          </p>
        </div>
        <UnitPicker value={unitId} onChange={setUnitId} />
      </div>
      {err && <ErrorBox message={err.message} />}
      {!eng.data || !skills.data || !readiness.data ? (
        <Loading />
      ) : (
        <>
          <div className="grid">
            <Stat label="Students" value={eng.data.totalStudents} sub={`${eng.data.activeLast7Days} active in the last 7 days`} />
            <Stat label="Weekly active" value={`${eng.data.weeklyActivePct}%`} sub="of students in scope" />
            <Stat label="Answers per active student" value={eng.data.answersPerActiveStudent} sub={`${eng.data.answersLast7Days} answers this week`} />
            <Stat label="At risk" value={readiness.data.atRisk.length} sub="service readiness below 30" />
          </div>

          <InsightsCard key={unitId} unitId={unitId} />

          {!unitId && me.permissions.includes("analytics.institution") && <Benchmarks />}

          <div className="card">
            <div className="spread">
              <h2 style={{ margin: 0 }}>Daily active students</h2>
              <span className="muted small">last 14 days</span>
            </div>
            <ActivityChart daily={eng.data.daily} total={eng.data.totalStudents} today={new Date()} timeZone={eng.data.timeZone} />
          </div>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
            <div className="card stack">
              <h2 style={{ margin: 0 }}>Placement readiness</h2>
              {readiness.data.profiles.map((p) => {
                const total = Object.values(p.bands).reduce((a, b) => a + b, 0) || 1;
                return (
                  <div key={p.id} className="stack" style={{ gap: 6 }}>
                    <div className="spread small">
                      <b>{p.name}</b>
                      <span className="muted">average {p.average}/100</span>
                    </div>
                    <div className="bar" style={{ display: "flex", height: 14 }} role="img" aria-label={BANDS.map((b) => `${b.label}: ${p.bands[b.key]}`).join(", ")}>
                      {BANDS.map((b) => (
                        <span key={b.key} style={{ width: `${(p.bands[b.key] / total) * 100}%`, background: b.color, borderRadius: 0 }} />
                      ))}
                    </div>
                  </div>
                );
              })}
              <div className="row wrap small muted" style={{ gap: 12 }}>
                {BANDS.map((b) => (
                  <span key={b.key} className="row" style={{ gap: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: b.color, display: "inline-block" }} />
                    {b.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="card stack">
              <h2 style={{ margin: 0 }}>Weakest skills</h2>
              {skills.data.weakest.map((s) => (
                <div key={s.skillId}>
                  <div className="spread small">
                    <span>
                      <b>{s.name}</b> <span className="muted">· {s.topicName}</span>
                    </span>
                    <span className="muted">
                      {s.avgMastery}% · {s.attemptedPct}% tried
                    </span>
                  </div>
                  <Bar value={s.avgMastery} tone={masteryTone(s.avgMastery)} />
                </div>
              ))}
              {me.permissions.includes("assignments.manage") && (
                <Link href="/console/assignments?new=1" className="small">
                  Assign practice on weak skills
                </Link>
              )}
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
            <div className="card stack">
              <h2 style={{ margin: 0 }}>Needs attention</h2>
              {readiness.data.atRisk.length === 0 ? (
                <p className="muted">No students below 30.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Service</th>
                      <th>Product</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readiness.data.atRisk.slice(0, 8).map((s) => (
                      <tr key={s.id}>
                        <td>
                          <Link href={`/console/students/${s.id}`}>{s.name}</Link> <span className="muted small">{s.rollNo}</span>
                        </td>
                        <td>{s.service}</td>
                        <td>{s.product}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="card stack">
              <h2 style={{ margin: 0 }}>Streaks</h2>
              {eng.data.streaks.map((b) => (
                <div key={b.label}>
                  <div className="spread small">
                    <span>{b.label}</span>
                    <span className="muted">{b.students}</span>
                  </div>
                  <Bar value={(b.students / Math.max(1, eng.data!.totalStudents)) * 100} />
                </div>
              ))}
            </div>
          </div>

          <div className="card stack">
            <h2 style={{ margin: 0 }}>All skills</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th>Topic</th>
                    <th style={{ width: "30%" }}>Average mastery</th>
                    <th>Tried</th>
                    <th>Accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {skills.data.skills.map((s) => (
                    <tr key={s.skillId}>
                      <td>{s.name}</td>
                      <td className="muted">{s.topicName}</td>
                      <td>
                        <div className="row">
                          <div style={{ flex: 1 }}>
                            <Bar value={s.avgMastery} tone={masteryTone(s.avgMastery)} />
                          </div>
                          <span className="small">{s.avgMastery}%</span>
                        </div>
                      </td>
                      <td>{s.attemptedPct}%</td>
                      <td>{s.accuracyPct === null ? "-" : `${s.accuracyPct}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
