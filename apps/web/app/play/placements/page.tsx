"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatLpa, INTERVIEW_FEEDBACK_DIMENSIONS, JOINING_STATUSES, OFFER_TIERS, STUDENT_JOINING_STATUSES, type CompanyType, type InterviewFeedbackDimension, type JoiningStatus, type OfferTier } from "@playcode/core";
import { Icon } from "@/components/Icon";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";
import { startAndOpen } from "@/lib/start";

interface Drive {
  id: string;
  company: string;
  companyType: CompanyType;
  roleTitle: string;
  description: string;
  ctcRupees: number;
  location: string;
  driveDate: string;
  registerBy: string;
  rounds: string[];
  pack: { id: string; title: string } | null;
  open: boolean;
  tier: OfferTier | null;
  eligibility: { eligible: boolean; reasons: string[] };
  application: { status: "registered" | "shortlisted" | "rejected" | "offered"; roundsCleared: number; offerCtcRupees: number | null; decision: "accepted" | "declined" | null; decideBy: string | null; joining: { status: JoiningStatus | null; joiningDate: string | null; note: string } | null; slots: Slot[]; test: { id: string; title: string; openAt: string; closeAt: string; round: string } | null } | null;
}

interface Slot {
  round: string;
  startsAt: string;
  panel: { name: string; room: string; interviewer: string };
  status: "scheduled" | "done" | "no_show" | "excused";
  feedback: { ratings: Record<InterviewFeedbackDimension, number>; wentWell: string; workOn: string; at: string } | null;
}

interface Placements {
  record: { cgpa: number | null; backlogs: number | null; tenthPct: number | null; twelfthPct: number | null; graduationYear: number | null } | null;
  attendance: { sessions: number; attended: number; pct: number | null };
  policy: { dreamFromRupees: number; superDreamFromRupees: number; maxOffers: number } | null;
  noShows: { count: number; max: number | null };
  drives: Drive[];
}

function Rounds({ drive }: { drive: Drive }) {
  const t = useT();
  const app = drive.application!;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {drive.rounds.map((r, i) => {
        const done = app.roundsCleared > i;
        const failed = app.status === "rejected" && app.roundsCleared === i;
        return (
          <div key={i} className="row small" style={{ gap: 8 }}>
            <span className={`path-dot ${done ? "done" : failed ? "locked" : i === app.roundsCleared ? "current" : "locked"}`} aria-hidden>
              {done ? <Icon name="check" size={14} /> : null}
            </span>
            <span style={{ fontWeight: i === app.roundsCleared && app.status !== "rejected" && app.status !== "offered" ? 700 : 400 }}>{r}</span>
            {done && <span className="muted">{t("cleared")}</span>}
            {failed && <span style={{ color: "var(--bad-ink)" }}>{t("not selected")}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Where an accepted offer stands: offer letter, joining date, joined. */
function Joining({ drive, joining, onChange }: { drive: Drive; joining: NonNullable<NonNullable<Drive["application"]>["joining"]>; onChange: (p: Placements) => void }) {
  const t = useT();
  const locale = useLocale();
  const [status, setStatus] = useState<JoiningStatus>(joining.status ?? "awaiting_letter");
  const [date, setDate] = useState(joining.joiningDate ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (joining.status === "revoked") {
    return (
      <div className="small" style={{ background: "var(--surface-2)", padding: "8px 10px", borderRadius: 8 }}>
        <b>{t(JOINING_STATUSES.revoked)}</b>
        <div>{t("It no longer counts as an offer you hold, so you can register for drives again.")}</div>
        {joining.note && <div className="muted">{joining.note}</div>}
      </div>
    );
  }
  const needsDate = status === "date_given" || status === "joined";
  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/student/placements/${drive.id}/joining`, { method: "PUT", body: { status, joiningDate: needsDate ? date || null : null } });
      onChange(await api<Placements>("/student/placements"));
      setMsg(t("Saved. Thank you!"));
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const id = `j-${drive.id}`;
  return (
    <div className="stack" style={{ gap: 6, background: "var(--surface-2)", padding: "8px 10px", borderRadius: 8 }}>
      <div className="small" style={{ fontWeight: 600 }}>
        {joining.status === "joined"
          ? t("Joined on {date}", { date: new Date(`${joining.joiningDate}T00:00:00`).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric" }) })
          : t("Where does your offer stand?")}
      </div>
      <div className="row wrap" style={{ gap: 6, alignItems: "flex-end" }}>
        <div>
          <label htmlFor={`${id}-s`} className="small">
            {t("Status")}
          </label>
          <select id={`${id}-s`} value={status} onChange={(e) => setStatus(e.target.value as JoiningStatus)}>
            {STUDENT_JOINING_STATUSES.map((k) => (
              <option key={k} value={k}>
                {t(JOINING_STATUSES[k])}
              </option>
            ))}
          </select>
        </div>
        {needsDate && (
          <div>
            <label htmlFor={`${id}-d`} className="small">
              {t("Joining date")}
            </label>
            <input id={`${id}-d`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        )}
        <button className="btn small" disabled={busy || (needsDate && !date)} onClick={save}>
          {t("Update")}
        </button>
      </div>
      {msg && (
        <div className="small" role="status">
          {msg}
        </div>
      )}
    </div>
  );
}

function DriveCard({ drive, experiences, onChange }: { drive: Drive; experiences: number; onChange: (p: Placements) => void }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fmt = (d: Date) => d.toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short" });
  const app = drive.application;

  async function call(action: "register" | "withdraw" | "accept" | "decline") {
    if (action === "withdraw" && !window.confirm(t("Withdraw your registration?"))) return;
    if (action === "accept" && !window.confirm(t("Accept the {company} offer? Any other offer still waiting for your answer is declined, and you can't change this yourself.", { company: drive.company }))) return;
    if (action === "decline" && !window.confirm(t("Decline the {company} offer? You can't undo this yourself.", { company: drive.company }))) return;
    setBusy(true);
    setError(null);
    try {
      const decision = action === "accept" || action === "decline";
      onChange(await api<Placements>(`/student/placements/${drive.id}/${decision ? "decision" : action}`, { body: decision ? { accept: action === "accept" } : {} }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function prepare() {
    if (!drive.pack) return;
    setBusy(true);
    setError(await startAndOpen({ kind: "pack", packId: drive.pack.id }, router.push));
    setBusy(false);
  }

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="spread" style={{ alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "1.125rem" }}>{drive.company}</div>
          <div className="small">{drive.roleTitle}</div>
          <div className="small muted">
            {formatLpa(drive.ctcRupees)}
            {drive.location && ` · ${drive.location}`} · {t("drive on {date}", { date: fmt(new Date(`${drive.driveDate}T00:00:00`)) })}
          </div>
          {drive.tier && drive.tier !== "regular" && <span className="pill accent small" style={{ marginTop: 4, display: "inline-block" }}>{t(OFFER_TIERS[drive.tier])}</span>}
        </div>
        {app?.status === "offered" ? (
          <span className="pill good">{t("Offer")}</span>
        ) : app?.status === "rejected" ? (
          <span className="pill">{t("Closed")}</span>
        ) : app ? (
          <span className="pill accent">{t("Registered")}</span>
        ) : drive.eligibility.eligible ? (
          <span className="pill good">{t("Eligible")}</span>
        ) : (
          <span className="pill">{t("Not eligible")}</span>
        )}
      </div>
      {app?.status === "offered" && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="small" style={{ fontWeight: 600 }}>
            {t("Congratulations! Offer of {ctc}.", { ctc: formatLpa(app.offerCtcRupees ?? drive.ctcRupees) })}
          </div>
          {app.decision ? (
            <>
              <span className={`pill ${app.decision === "accepted" ? "good" : ""}`} style={{ alignSelf: "flex-start" }}>
                {t(app.decision === "accepted" ? "You accepted this offer" : "You declined this offer")}
              </span>
              {app.joining && <Joining drive={drive} joining={app.joining} onChange={onChange} />}
            </>
          ) : app.decideBy && new Date(app.decideBy) > new Date() ? (
            <>
              <div className="small">{t("Accept or decline by {date}. If you don't answer, it's taken as accepted.", { date: new Date(app.decideBy).toLocaleString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })}</div>
              <div className="row wrap">
                <button className="btn primary small" disabled={busy} onClick={() => call("accept")}>
                  {t("Accept offer")}
                </button>
                <button className="btn ghost small" disabled={busy} onClick={() => call("decline")}>
                  {t("Decline")}
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}
      {app && app.slots.some((s) => s.status === "scheduled" && new Date(s.startsAt).getTime() > Date.now() - 3 * 3_600_000) && (
        <div className="stack" style={{ gap: 4, background: "var(--surface-2)", padding: "8px 10px", borderRadius: 8 }}>
          {app.slots
            .filter((s) => s.status === "scheduled" && new Date(s.startsAt).getTime() > Date.now() - 3 * 3_600_000)
            .map((s) => (
              <div key={`${s.round}-${s.startsAt}`} className="small">
                <b>
                  {s.round}: {new Date(s.startsAt).toLocaleString(locale === "hi" ? "hi-IN" : "en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                </b>
                <div>
                  {s.panel.name}
                  {s.panel.room ? ` · ${s.panel.room}` : ""}
                  {s.panel.interviewer ? ` · ${s.panel.interviewer}` : ""}
                </div>
              </div>
            ))}
          <div className="small muted">{t("Be there 10 minutes early with your resume and college ID.")}</div>
        </div>
      )}
      {app?.test && new Date(app.test.closeAt) > new Date() && (
        <div className="stack" style={{ gap: 4, background: "var(--surface-2)", padding: "8px 10px", borderRadius: 8 }}>
          <div className="small">
            <b>{t("{round} on PlayCode: {title}", { round: app.test.round, title: app.test.title })}</b>
            <div>
              {new Date(app.test.openAt) > new Date()
                ? t("Opens {date}", { date: new Date(app.test.openAt).toLocaleString(locale === "hi" ? "hi-IN" : "en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })
                : t("Open until {date}", { date: new Date(app.test.closeAt).toLocaleString(locale === "hi" ? "hi-IN" : "en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })}
            </div>
          </div>
          {new Date(app.test.openAt) <= new Date() && (
            <Link className="btn primary small" style={{ alignSelf: "flex-start" }} href={`/play/tests/${app.test.id}`}>
              {t("Take the test")}
            </Link>
          )}
        </div>
      )}
      {app?.slots
        .filter((s) => s.feedback)
        .map((s) => (
          <div key={`fb-${s.round}`} className="stack" style={{ gap: 4, border: "1px solid var(--border)", padding: "8px 10px", borderRadius: 8 }}>
            <b className="small">{t("Feedback from your {round}", { round: s.round })}</b>
            <div className="row wrap small" style={{ gap: 10 }}>
              {(Object.keys(INTERVIEW_FEEDBACK_DIMENSIONS) as InterviewFeedbackDimension[]).map((d) => (
                <span key={d}>
                  {t(INTERVIEW_FEEDBACK_DIMENSIONS[d])}: <b>{s.feedback!.ratings[d]}/5</b>
                </span>
              ))}
            </div>
            {s.feedback!.wentWell && (
              <div className="small">
                <b>{t("Went well:")}</b> {s.feedback!.wentWell}
              </div>
            )}
            {s.feedback!.workOn && (
              <div className="small">
                <b>{t("To work on:")}</b> {s.feedback!.workOn}
              </div>
            )}
          </div>
        ))}
      {app ? (
        <Rounds drive={drive} />
      ) : drive.eligibility.eligible ? (
        <div className="small muted">
          {t("Register by {date}. Rounds: {rounds}.", { date: fmt(new Date(drive.registerBy)), rounds: drive.rounds.join(", ") })} {t("Registering shares your resume with {company}.", { company: drive.company })}
        </div>
      ) : (
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          {drive.eligibility.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {drive.description && !app && <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{drive.description}</p>}
      {error && <ErrorBox message={error} />}
      <div className="row wrap">
        {!app && drive.open && drive.eligibility.eligible && (
          <button className="btn primary small" disabled={busy} onClick={() => call("register")}>
            {t("Register")}
          </button>
        )}
        {(app?.status === "registered" || app?.status === "shortlisted") && drive.pack && (
          <button className="btn primary small" disabled={busy} onClick={prepare}>
            {t("Prepare: {mission}", { mission: drive.pack.title })}
          </button>
        )}
        {!app && drive.eligibility.eligible && drive.pack && (
          <button className="btn small" disabled={busy} onClick={prepare}>
            {t("Practise the mission")}
          </button>
        )}
        <Link className="btn small" href={`/play/companies?name=${encodeURIComponent(drive.company)}`}>
          {t("About {company}", { company: drive.company })}
        </Link>
        {experiences > 0 && (
          <Link className="btn small" href={`/play/experiences?company=${encodeURIComponent(drive.company)}`}>
            {t("Interview experiences ({n})", { n: experiences })}
          </Link>
        )}
        {(app?.status === "registered" || app?.status === "shortlisted") && (
          <Link className="btn small" href={`/play/interview?track=${drive.companyType === "product" ? "product" : "service"}`}>
            {t("Mock interview")}
          </Link>
        )}
        {app?.status === "registered" && drive.open && (
          <button className="btn ghost small" disabled={busy} onClick={() => call("withdraw")}>
            {t("Withdraw")}
          </button>
        )}
      </div>
    </div>
  );
}

export default function StudentPlacements() {
  const t = useT();
  const { data, error, loading, reload, setData } = useApi<Placements>("/student/placements");
  const counts = useApi<{ counts: Record<string, number> }>("/student/experiences/counts").data?.counts ?? {};
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const open = data.drives.filter((d) => !d.application);
  const mine = data.drives.filter((d) => d.application);
  const r = data.record;
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>{t("Placements")}</h1>
      <div className="card tight small">
        {r ? (
          <span>
            {t("Your record")}: CGPA {r.cgpa ?? "-"} · {t("backlogs")} {r.backlogs ?? "-"} · {t("class 10")} {r.tenthPct ?? "-"}% · {t("class 12")} {r.twelfthPct ?? "-"}%
            {r.graduationYear ? ` · ${r.graduationYear}` : ""}
          </span>
        ) : (
          <span className="muted">{t("Your academic record is not on file yet. The placement cell adds it.")}</span>
        )}
        {data.attendance.pct !== null && (
          <div>
            {t("Training attendance")}: {data.attendance.pct}% ({t("{attended} of {held} sessions", { attended: data.attendance.attended, held: data.attendance.sessions })})
          </div>
        )}
        <div>
          <Link href="/play/help?new=record" className="muted">
            {t("Something wrong? Tell your placement cell.")}
          </Link>
        </div>
      </div>
      {data.noShows.count > 0 && (
        <div className="card tight small" role="note" style={{ borderColor: "var(--warn)" }}>
          {data.noShows.max !== null && data.noShows.count >= data.noShows.max
            ? t("You missed {n} drives you registered for, so you can't register for new ones. Talk to your placement cell.", { n: data.noShows.count })
            : data.noShows.max !== null
              ? t("You missed {n} of the drives you registered for. After {max}, you can't register for new ones.", { n: data.noShows.count, max: data.noShows.max })
              : t("You missed {n} of the drives you registered for. If you can't go, withdraw before registration closes.", { n: data.noShows.count })}{" "}
          <Link href="/play/help?new=drive">{t("Had a reason? Tell your placement cell.")}</Link>
        </div>
      )}
      {data.policy && (
        <div className="card tight small">
          <b>{t("Placement policy")}</b>
          <div>
            {t("Offers from {dream} are Dream, from {superDream} Super dream. With an offer, you can only sit for drives in a higher tier, up to {n} offers.", {
              dream: formatLpa(data.policy.dreamFromRupees),
              superDream: formatLpa(data.policy.superDreamFromRupees),
              n: data.policy.maxOffers,
            })}
          </div>
        </div>
      )}
      <Link href="/play/openings" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{t("Openings off campus")}</b>
          <div className="small muted">{t("Off-campus drives, pool campuses and internships your placement cell found for you")}</div>
        </div>
        <span aria-hidden="true">→</span>
      </Link>
      <Link href="/play/companies" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{t("Companies")}</b>
          <div className="small muted">{t("Every company that has visited: roles, packages, rounds and how many got through")}</div>
        </div>
        <span aria-hidden="true">→</span>
      </Link>
      <Link href="/play/experiences" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{t("Interview experiences")}</b>
          <div className="small muted">{t("Read what seniors faced in each round, or share your own")}</div>
        </div>
        <span aria-hidden="true">→</span>
      </Link>
      <Link href="/play/outcomes" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{t("Offers and admissions")}</b>
          <div className="small muted">{t("Got an offer off campus, an admission or a GATE score? Tell your placement cell")}</div>
        </div>
        <span aria-hidden="true">→</span>
      </Link>
      {mine.length > 0 && (
        <>
          <h2 style={{ margin: "8px 0 0" }}>{t("My applications")}</h2>
          {mine.map((d) => (
            <DriveCard key={d.id} drive={d} experiences={counts[d.company.toLowerCase()] ?? 0} onChange={setData} />
          ))}
        </>
      )}
      <h2 style={{ margin: "8px 0 0" }}>{t("Open drives")}</h2>
      {open.length === 0 ? (
        <div className="card muted">{t("No drives open right now. Keep practising: your readiness score is what companies' tests measure.")}</div>
      ) : (
        open.map((d) => <DriveCard key={d.id} drive={d} experiences={counts[d.company.toLowerCase()] ?? 0} onChange={setData} />)
      )}
    </div>
  );
}
