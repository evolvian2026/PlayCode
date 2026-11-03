"use client";

import { useState } from "react";
import { useMe } from "@/components/Auth";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface Batch {
  id: string;
  name: string;
  department: string | null;
  current: number;
  graduated: number;
  graduation: {
    id: string;
    graduatedAt: string;
    by: string | null;
    canUndo: boolean;
  } | null;
  alumniJoined: number;
  survey: {
    responses: number;
    averages: Record<string, number | null> | null;
    recommendPct: number | null;
    comments: string[];
  };
}
interface Overview {
  batches: Batch[];
  items: { key: string; label: string }[];
  minResponses: number;
}
interface Preview {
  students: number;
  placed: number;
  undecidedOffers: number;
  seatsFreed: number;
}

const date = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

function Graduate({ b, onDone }: { b: Batch; onDone: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg(errorMessage(e));
    }
    setBusy(false);
  }
  if (!preview)
    return (
      <div>
        <button
          className="btn small"
          disabled={busy}
          onClick={() =>
            run(async () =>
              setPreview(
                await api<Preview>(`/console/graduation/${b.id}/preview`),
              ),
            )
          }
        >
          Graduate this batch…
        </button>
        {msg && <ErrorBox message={msg} />}
      </div>
    );
  return (
    <div
      className="stack"
      style={{
        gap: 8,
        background: "var(--surface-2)",
        padding: 12,
        borderRadius: 8,
      }}
    >
      <b>Graduate {b.name}?</b>
      <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
        <li>
          {preview.students} students&apos; accounts become read-only: they can
          still sign in, see and download their resume, certificates and
          records, and answer offers and joining.
        </li>
        <li>
          {preview.seatsFreed} seats are freed on your licence, and the batch
          stops getting reminders, nudges and parent emails.
        </li>
        <li>
          Each is asked to join the alumni list and to answer the exit survey.
        </li>
        {preview.undecidedOffers > 0 && (
          <li>
            {preview.undecidedOffers} offers are still undecided; students can
            still answer them.
          </li>
        )}
        <li>You can undo this for two weeks.</li>
      </ul>
      <div className="small muted">
        {preview.placed} of them have accepted a campus offer.
      </div>
      {msg && <ErrorBox message={msg} />}
      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn primary small"
          disabled={busy || !preview.students}
          onClick={() =>
            run(async () => {
              await api(`/console/graduation/${b.id}`, { body: {} });
              onDone();
            })
          }
        >
          Graduate {preview.students} students
        </button>
        <button className="btn ghost small" onClick={() => setPreview(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Survey({ b, o }: { b: Batch; o: Overview }) {
  const s = b.survey;
  if (!s.averages)
    return (
      <div className="small muted">
        Exit survey: {s.responses} {s.responses === 1 ? "answer" : "answers"} so
        far. Results show from {o.minResponses} answers, so nobody can be picked
        out.
      </div>
    );
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="small">
        <b>Exit survey</b>: {s.responses} of {b.graduated} answered ·{" "}
        {s.recommendPct}% would tell juniors to use the placement cell&apos;s
        help
      </div>
      <div className="stack" style={{ gap: 4 }}>
        {o.items.map((i) => {
          const v = s.averages![i.key] ?? 0;
          return (
            <div key={i.key} className="row small" style={{ gap: 8 }}>
              <span style={{ flex: "0 0 320px" }}>{i.label}</span>
              <span
                aria-hidden="true"
                style={{
                  flex: "0 0 140px",
                  height: 8,
                  background: "var(--surface-2)",
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    display: "block",
                    width: `${(v / 5) * 100}%`,
                    height: "100%",
                    background: v < 3.5 ? "var(--warn)" : "var(--accent)",
                  }}
                />
              </span>
              <b>{v.toFixed(1)}</b>
            </div>
          );
        })}
      </div>
      {s.comments.length > 0 && (
        <details>
          <summary className="small">
            What graduates said ({s.comments.length})
          </summary>
          <ul className="small" style={{ marginTop: 6 }}>
            {s.comments.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function GraduationPage() {
  const me = useMe();
  const manage = me.permissions.includes("users.manage");
  const { data, error, loading, reload } = useApi<Overview>(
    "/console/graduation",
  );
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  async function undo(id: string) {
    if (
      !window.confirm(
        "Undo this graduation? The students become current again and use seats.",
      )
    )
      return;
    setMsg(null);
    try {
      await api(`/console/graduation/records/${id}/undo`, { body: {} });
      reload();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1000 }}>
      <div>
        <h1 style={{ margin: 0 }}>Graduation</h1>
        <p className="muted" style={{ margin: 0 }}>
          At the end of the final year, mark the batch as graduated: their
          accounts stay open to read, their seats are freed, and each graduate
          is asked to join the alumni list and say how training and placement
          went.
        </p>
      </div>
      {msg && <ErrorBox message={msg} />}
      {data.batches.map((b) => (
        <section
          key={b.id}
          className="card stack"
          aria-labelledby={`h-${b.id}`}
        >
          <div className="spread wrap" style={{ gap: 8 }}>
            <div>
              <h2 id={`h-${b.id}`} style={{ margin: 0, fontSize: 18 }}>
                {b.name}
              </h2>
              <div className="small muted">
                {[
                  b.department,
                  b.current ? `${b.current} current students` : null,
                  b.graduated ? `${b.graduated} graduated` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            {b.graduation && (
              <div className="row wrap small" style={{ gap: 8 }}>
                <span className="pill good">
                  Graduated {date(b.graduation.graduatedAt)}
                  {b.graduation.by ? ` by ${b.graduation.by}` : ""}
                </span>
                {manage && b.graduation.canUndo && (
                  <button
                    className="btn ghost small"
                    onClick={() => undo(b.graduation!.id)}
                  >
                    Undo
                  </button>
                )}
              </div>
            )}
          </div>
          {b.graduated > 0 && (
            <>
              <div className="small">
                <b>{b.alumniJoined}</b> joined the alumni list
              </div>
              <Survey b={b} o={data} />
            </>
          )}
          {manage && b.current > 0 && <Graduate b={b} onDone={reload} />}
        </section>
      ))}
    </div>
  );
}
