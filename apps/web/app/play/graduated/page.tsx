"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { ExitItem } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface Entry {
  email: string;
  company: string;
  role: string;
  city: string;
  openToReferrals: boolean;
  openToAdvice: boolean;
}
interface Graduation {
  graduated: { at: string } | null;
  alumni?: {
    choice: "joined" | "declined" | null;
    entry: Entry | null;
    prefill: Entry & {
      name: string;
      graduationYear: number;
      department: string;
    };
  };
  survey?: { done: boolean; items: { key: ExitItem; label: string }[] };
}

function AlumniForm({
  g,
  onDone,
  onCancel,
}: {
  g: Graduation;
  onDone: (g: Graduation) => void;
  onCancel?: () => void;
}) {
  const t = useT();
  const start = g.alumni!.entry ?? {
    ...g.alumni!.prefill,
    openToAdvice: true,
    openToReferrals: false,
  };
  const [f, setF] = useState<Entry>({
    email: start.email,
    company: start.company,
    role: start.role,
    city: start.city,
    openToAdvice: start.openToAdvice,
    openToReferrals: start.openToReferrals,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      onDone(await api<Graduation>("/student/graduation/alumni", { body: f }));
    } catch (err) {
      setMsg(errorMessage(err));
    }
    setBusy(false);
  }
  const field = (
    k: "company" | "role" | "city" | "email",
    label: string,
    extra: { type?: string; required?: boolean; placeholder?: string } = {},
  ) => (
    <div>
      <label htmlFor={`a-${k}`}>{t(label)}</label>
      <input
        id={`a-${k}`}
        type={extra.type ?? "text"}
        value={f[k]}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
        required={extra.required}
        placeholder={extra.placeholder}
        maxLength={120}
      />
    </div>
  );
  return (
    <form className="stack" onSubmit={submit} style={{ gap: 10 }}>
      {field("company", "Where you work or study now", { required: true })}
      {field("role", "Role (optional)")}
      {field("city", "City (optional)")}
      {field("email", "An email you'll keep using", {
        type: "email",
        required: true,
      })}
      <div className="small muted">
        {t(
          "Your college email may stop working. Juniors never see your email: the placement cell sends introductions to you.",
        )}
      </div>
      <fieldset
        className="stack"
        style={{ gap: 6, border: 0, padding: 0, margin: 0 }}
      >
        <legend className="small muted" style={{ padding: 0, marginBottom: 6 }}>
          {t("Juniors can ask you for")}
        </legend>
        <label className="row small" style={{ gap: 6 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={f.openToAdvice}
            onChange={(e) => setF({ ...f, openToAdvice: e.target.checked })}
          />
          {t("Advice about your company, role or course")}
        </label>
        <label className="row small" style={{ gap: 6 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={f.openToReferrals}
            onChange={(e) => setF({ ...f, openToReferrals: e.target.checked })}
          />
          {t("A referral, when there's an opening")}
        </label>
      </fieldset>
      {msg && <ErrorBox message={msg} />}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary small" disabled={busy}>
          {g.alumni!.entry ? t("Save") : t("Join the alumni list")}
        </button>
        {onCancel && (
          <button type="button" className="btn ghost small" onClick={onCancel}>
            {t("Cancel")}
          </button>
        )}
      </div>
    </form>
  );
}

function Alumni({
  g,
  onChange,
}: {
  g: Graduation;
  onChange: (g: Graduation) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const a = g.alumni!;
  async function decline() {
    setMsg(null);
    try {
      onChange(
        await api<Graduation>("/student/graduation/alumni/decline", {
          body: {},
        }),
      );
      setEditing(false);
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  return (
    <section className="card stack" aria-labelledby="h-alumni">
      <div>
        <h2 id="h-alumni" style={{ margin: 0 }}>
          {t("Join the alumni list")}
        </h2>
        <p className="small muted" style={{ margin: 0 }}>
          {t(
            "Juniors looking at your company can ask the placement cell to introduce them to you. You decide whether to reply.",
          )}
        </p>
      </div>
      {a.entry && !editing ? (
        <div className="stack" style={{ gap: 6 }}>
          <div>
            <span className="pill good">{t("You're on the list")}</span>
          </div>
          <div className="small">
            {[a.entry.role, a.entry.company, a.entry.city]
              .filter(Boolean)
              .join(", ")}{" "}
            ·{" "}
            {[
              a.entry.openToAdvice && t("advice"),
              a.entry.openToReferrals && t("referrals"),
            ]
              .filter(Boolean)
              .join(", ")}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn small" onClick={() => setEditing(true)}>
              {t("Edit")}
            </button>
            <button className="btn ghost small" onClick={decline}>
              {t("Take me off the list")}
            </button>
          </div>
        </div>
      ) : a.choice === "declined" && !editing ? (
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="small muted">{t("You're not on the list.")}</span>
          <button className="btn small" onClick={() => setEditing(true)}>
            {t("Join after all")}
          </button>
        </div>
      ) : (
        <>
          <AlumniForm
            g={g}
            onDone={(x) => {
              onChange(x);
              setEditing(false);
            }}
            onCancel={editing ? () => setEditing(false) : undefined}
          />
          {!a.choice && (
            <button
              className="btn ghost small"
              style={{ alignSelf: "flex-start" }}
              onClick={decline}
            >
              {t("No thanks")}
            </button>
          )}
        </>
      )}
      {msg && <ErrorBox message={msg} />}
    </section>
  );
}

function Survey({
  g,
  onChange,
}: {
  g: Graduation;
  onChange: (g: Graduation) => void;
}) {
  const t = useT();
  const items = g.survey!.items;
  const [ratings, setRatings] = useState<Partial<Record<ExitItem, number>>>({});
  const [recommend, setRecommend] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const complete = items.every((i) => ratings[i.key]) && recommend !== null;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      onChange(
        await api<Graduation>("/student/graduation/survey", {
          body: { ratings, recommend, comment },
        }),
      );
    } catch (err) {
      setMsg(errorMessage(err));
    }
    setBusy(false);
  }
  if (g.survey!.done)
    return (
      <section className="card stack" aria-labelledby="h-survey">
        <h2 id="h-survey" style={{ margin: 0 }}>
          {t("How did training and placement go?")}
        </h2>
        <div className="small">
          {t(
            "Thank you. The placement cell reads these together, without names, to plan for the next batch.",
          )}
        </div>
      </section>
    );
  return (
    <form className="card stack" onSubmit={submit} aria-labelledby="h-survey">
      <div>
        <h2 id="h-survey" style={{ margin: 0 }}>
          {t("How did training and placement go?")}
        </h2>
        <p className="small muted" style={{ margin: 0 }}>
          {t(
            "Two minutes. The placement cell sees the answers together, without names, to plan for the next batch.",
          )}
        </p>
      </div>
      {items.map((i) => (
        <fieldset
          key={i.key}
          className="stack"
          style={{ gap: 4, border: 0, padding: 0, margin: 0 }}
        >
          <legend className="small" style={{ padding: 0, marginBottom: 4 }}>
            {t(i.label)}
          </legend>
          <div className="row" style={{ gap: 12 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="row small" style={{ gap: 4 }}>
                <input
                  type="radio"
                  name={`r-${i.key}`}
                  style={{ width: "auto" }}
                  checked={ratings[i.key] === n}
                  onChange={() => setRatings({ ...ratings, [i.key]: n })}
                />
                {n}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="small muted">{t("1 is poor, 5 is excellent.")}</div>
      <fieldset
        className="stack"
        style={{ gap: 4, border: 0, padding: 0, margin: 0 }}
      >
        <legend className="small" style={{ padding: 0, marginBottom: 4 }}>
          {t(
            "Would you tell juniors to make use of the placement cell's help?",
          )}
        </legend>
        <div className="row" style={{ gap: 12 }}>
          {([true, false] as const).map((v) => (
            <label key={String(v)} className="row small" style={{ gap: 4 }}>
              <input
                type="radio"
                name="recommend"
                style={{ width: "auto" }}
                checked={recommend === v}
                onChange={() => setRecommend(v)}
              />
              {t(v ? "Yes" : "No")}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="s-comment">
          {t(
            "What should the placement cell do more of, or differently? (optional)",
          )}
        </label>
        <textarea
          id="s-comment"
          className="prose"
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={1000}
        />
      </div>
      {msg && <ErrorBox message={msg} />}
      <div>
        <button className="btn primary small" disabled={busy || !complete}>
          {t("Send")}
        </button>
      </div>
    </form>
  );
}

export default function GraduatedPage() {
  const t = useT();
  const { data, error, loading, reload, setData } = useApi<Graduation>(
    "/student/graduation",
  );
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  if (!data.graduated)
    return (
      <div className="card stack">
        <h1 style={{ margin: 0 }}>{t("Not yet")}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {t(
            "This page opens once your college marks your batch as graduated.",
          )}
        </p>
      </div>
    );
  return (
    <div className="stack">
      <div>
        <h1 style={{ margin: 0 }}>{t("Congratulations, graduate")}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {t(
            "Practice is closed now, but your resume, certificates and records stay here for you.",
          )}
        </p>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <Link href="/play/resume" className="btn small">
          {t("My resume")}
        </Link>
        <Link href="/play/placements" className="btn small">
          {t("Placements")}
        </Link>
      </div>
      <Alumni g={data} onChange={setData} />
      <Survey g={data} onChange={setData} />
    </div>
  );
}
