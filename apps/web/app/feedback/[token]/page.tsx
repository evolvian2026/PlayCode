"use client";

import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";

interface Form {
  institution: string;
  company: string;
  roleTitle: string;
  driveDate: string;
  took: number;
  offers: number;
  dimensions: { key: string; label: string }[];
  answers: {
    submittedAt: string | null;
    ratings: Record<string, number> | null;
    wentWell: string;
    gaps: string;
    returnNextYear: "yes" | "maybe" | "no" | null;
    plannedHires: number | null;
    respondentName: string;
    respondentRole: string;
  };
}

const SCALE = ["Poor", "Below expectations", "Met expectations", "Good", "Excellent"];

/** The company's feedback on an institution's students after a drive. Opened from a private link; no account. */
export default function RecruiterFeedbackPage() {
  const { token } = useParams<{ token: string }>();
  const [form, setForm] = useState<Form | null | "missing">(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [f, setF] = useState({ wentWell: "", gaps: "", returnNextYear: "", plannedHires: "", respondentName: "", respondentRole: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<Form>(`/public/feedback/${encodeURIComponent(token)}`)
      .then((d) => {
        setForm(d);
        const a = d.answers;
        if (a.ratings) setRatings(a.ratings);
        setF({ wentWell: a.wentWell, gaps: a.gaps, returnNextYear: a.returnNextYear ?? "", plannedHires: a.plannedHires === null ? "" : String(a.plannedHires), respondentName: a.respondentName, respondentRole: a.respondentRole });
      })
      .catch(() => setForm("missing"));
  }, [token]);

  if (form === null) return <p className="muted center" style={{ paddingTop: 80 }}>Loading...</p>;
  if (form === "missing") {
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "64px 16px" }} className="card">
        <h1>Link not valid</h1>
        <p className="muted">This feedback link has expired or been replaced. Ask the placement cell for a new one.</p>
      </main>
    );
  }
  const complete = form.dimensions.every((d) => ratings[d.key]) && f.returnNextYear;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api(`/public/feedback/${encodeURIComponent(token)}`, {
        body: { ratings, wentWell: f.wentWell, gaps: f.gaps, returnNextYear: f.returnNextYear, plannedHires: f.plannedHires.trim() ? Number(f.plannedHires) : null, respondentName: f.respondentName, respondentRole: f.respondentRole },
      });
      setSaved(true);
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const day = new Date(`${(form as Form).driveDate}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  if (saved) {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "64px 16px" }} className="card stack">
        <h1 style={{ margin: 0 }}>Thank you</h1>
        <p style={{ margin: 0 }}>
          {form.institution}&apos;s placement cell has your feedback, and it will shape how they train the next batch. You can change it from this link for a few weeks.
        </p>
      </main>
    );
  }
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 16px" }}>
      <form className="stack" onSubmit={submit}>
        <div>
          <div className="muted">{form.institution}</div>
          <h1 style={{ margin: 0 }}>How did our students do?</h1>
          <p className="muted" style={{ margin: 0 }}>
            {form.company} · {form.roleTitle} · drive on {day} · {form.took} students took part, {form.offers} received offers. Two minutes, no sign-in.
          </p>
        </div>
        {form.dimensions.map((d) => (
          <fieldset key={d.key} className="card stack" style={{ gap: 8, margin: 0 }}>
            <legend style={{ fontWeight: 600, padding: 0, float: "left", width: "100%" }}>{d.label}</legend>
            <div className="row wrap" style={{ gap: 6 }}>
              {SCALE.map((label, i) => (
                <label key={label} className="row small" style={{ gap: 4, border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", background: ratings[d.key] === i + 1 ? "var(--accent-soft)" : undefined }}>
                  <input type="radio" name={d.key} value={i + 1} style={{ width: "auto" }} checked={ratings[d.key] === i + 1} onChange={() => setRatings({ ...ratings, [d.key]: i + 1 })} />
                  {i + 1} · {label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="card stack">
          <div>
            <label htmlFor="fb-well">What did our students do well?</label>
            <textarea id="fb-well" className="prose" rows={3} value={f.wentWell} onChange={(e) => setF({ ...f, wentWell: e.target.value })} maxLength={2000} />
          </div>
          <div>
            <label htmlFor="fb-gaps">Where did they fall short?</label>
            <textarea id="fb-gaps" className="prose" rows={3} value={f.gaps} onChange={(e) => setF({ ...f, gaps: e.target.value })} maxLength={2000} />
          </div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <div>
              <label htmlFor="fb-return">Will you hire here next year?</label>
              <select id="fb-return" value={f.returnNextYear} onChange={(e) => setF({ ...f, returnNextYear: e.target.value })} required>
                <option value="">Choose</option>
                <option value="yes">Yes</option>
                <option value="maybe">Maybe</option>
                <option value="no">Not next year</option>
              </select>
            </div>
            <div>
              <label htmlFor="fb-hires">About how many hires? (optional)</label>
              <input id="fb-hires" type="number" min={0} max={5000} value={f.plannedHires} onChange={(e) => setF({ ...f, plannedHires: e.target.value })} />
            </div>
            <div>
              <label htmlFor="fb-name">Your name (optional)</label>
              <input id="fb-name" value={f.respondentName} onChange={(e) => setF({ ...f, respondentName: e.target.value })} maxLength={120} />
            </div>
            <div>
              <label htmlFor="fb-role">Your role (optional)</label>
              <input id="fb-role" value={f.respondentRole} onChange={(e) => setF({ ...f, respondentRole: e.target.value })} maxLength={120} />
            </div>
          </div>
        </div>
        {msg && (
          <div className="error" role="alert">
            {msg}
          </div>
        )}
        <div>
          <button className="btn primary" disabled={busy || !complete}>
            {form.answers.submittedAt ? "Update feedback" : "Send feedback"}
          </button>
          {!complete && <span className="small muted"> Rate all four, and say whether you'll come back.</span>}
        </div>
      </form>
    </main>
  );
}
