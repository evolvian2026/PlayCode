"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Bar, masteryTone } from "@/components/ui";
import { api } from "@/lib/api";

interface PublicProfile {
  name: string;
  headline: string;
  about: string;
  links: { github?: string; linkedin?: string; portfolio?: string };
  institution: string;
  appName: string;
  program: string | null;
  graduationYear: number | null;
  readiness: { id: string; name: string; score: number }[];
  skills: { name: string; mastery: number }[];
  certificates: { title: string; code: string; scorePct: number; issuedAt: string; verifyUrl: string }[];
  practice: { questionsSolved: number; codingProblemsSolved: number; sqlProblemsSolved: number; activeDays90: number; longestStreak: number };
  mockInterview: { track: string; overall: number } | null;
  contests: { rating: number; rated: number } | null;
  verifiedAt: string;
}

/** A student's public profile, for recruiters. Everything under "Verified" is measured by PlayCode. */
export default function PublicProfilePage() {
  const { code } = useParams<{ code: string }>();
  const [data, setData] = useState<PublicProfile | null | "missing">(null);
  useEffect(() => {
    api<PublicProfile>(`/public/profiles/${encodeURIComponent(code)}`)
      .then(setData)
      .catch(() => setData("missing"));
  }, [code]);

  if (data === null) return <p className="muted center" style={{ paddingTop: 80 }}>Loading profile...</p>;
  if (data === "missing") {
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "64px 16px" }} className="card">
        <h1>Profile not found</h1>
        <p className="muted">This link is not valid, or the student has made their profile private.</p>
      </main>
    );
  }
  const links = (["linkedin", "github", "portfolio"] as const).filter((k) => data.links[k]);
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }} className="stack">
      <div className="card stack">
        <div>
          <h1 style={{ margin: 0 }}>{data.name}</h1>
          {data.headline && <div>{data.headline}</div>}
          <div className="muted small">
            {data.institution}
            {data.program && ` · ${data.program}`}
            {data.graduationYear && ` · graduating ${data.graduationYear}`}
          </div>
        </div>
        {data.about && <p style={{ margin: 0 }}>{data.about}</p>}
        {links.length > 0 && (
          <div className="row wrap small">
            {links.map((k) => (
              <a key={k} href={data.links[k]} target="_blank" rel="noopener noreferrer nofollow">
                {{ linkedin: "LinkedIn", github: "GitHub", portfolio: "Portfolio" }[k]}
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="card stack">
        <div className="spread wrap">
          <h2 style={{ margin: 0 }}>Verified by {data.appName}</h2>
          <span className="pill good">Checked {new Date(data.verifiedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Measured from the student&apos;s practice on the platform, not self-reported. Readiness estimates how ready they are for that kind of company&apos;s online test.
        </p>
        {data.readiness.map((r) => (
          <div key={r.id}>
            <div className="spread small">
              <span>{r.name} readiness</span>
              <b>{r.score}/100</b>
            </div>
            <Bar value={r.score} tone={masteryTone(r.score)} />
          </div>
        ))}
        <div className="small">
          {data.practice.questionsSolved} practice questions, {data.practice.codingProblemsSolved} coding and {data.practice.sqlProblemsSolved} SQL problems solved · {data.practice.activeDays90} practice days in the last 90 · longest
          streak {data.practice.longestStreak} days
        </div>
        {data.contests && (
          <div className="small">
            Coding contest rating {data.contests.rating} over {data.contests.rated} rated contest{data.contests.rated === 1 ? "" : "s"}
          </div>
        )}
        {data.mockInterview && (
          <div className="small">
            Mock technical interview ({data.mockInterview.track} company): {data.mockInterview.overall}/5
          </div>
        )}
        {data.skills.length > 0 && (
          <div className="row wrap">
            {data.skills.map((s) => (
              <span key={s.name} className="pill accent">
                {s.name} {s.mastery}%
              </span>
            ))}
          </div>
        )}
      </div>
      {data.certificates.length > 0 && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Certificates</h2>
          {data.certificates.map((c) => (
            <div key={c.code} className="spread">
              <div>
                <b>{c.title}</b>
                <div className="small muted">
                  {c.scorePct}% · {new Date(c.issuedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </div>
              </div>
              <a className="btn small" href={`/verify/${c.code}`}>
                Verify
              </a>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
