"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface LinkInfo {
  id: string;
  title: string | null;
  course: string | null;
  platform: string;
  assignmentId: string | null;
  gradebook: boolean;
}

// A teacher placed PlayCode in an LMS course and launched it: choose which assignment the activity opens.
function Bind() {
  const id = useSearchParams().get("id") ?? "";
  const link = useApi<{ link: LinkInfo }>(id ? `/console/lti/links/${id}` : null);
  const list = useApi<{ assignments: { id: string; title: string; closeAt: string; units: { name: string }[] }[] }>("/console/assignments");
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (link.error) return <ErrorBox message={link.error.message} onRetry={link.reload} />;
  if (!link.data || !list.data) return <Loading />;
  const l = link.data.link;
  const current = list.data.assignments.find((a) => a.id === l.assignmentId);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/console/lti/links/${id}`, { body: { assignmentId: choice } });
      setDone(true);
      link.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 640 }}>
      <h1 style={{ margin: 0 }}>Connect an LMS activity</h1>
      <div className="card stack" style={{ gap: 6 }}>
        <b>{l.title ?? "Untitled activity"}</b>
        <span className="small muted">
          {l.course ? `${l.course} · ` : ""}
          {l.platform}
        </span>
        <span className="small">
          {l.gradebook ? "Scores go to the course gradebook when a student finishes." : "This activity has no gradebook column, so scores stay in PlayCode."}
        </span>
        {current && <span className="pill good" style={{ alignSelf: "flex-start" }}>Opens: {current.title}</span>}
      </div>
      <div className="card stack">
        <label htmlFor="lti-asg">Assignment students should open from this activity</label>
        <select id="lti-asg" value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Choose an assignment</option>
          {list.data.assignments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title} ({a.units.map((u) => u.name).join(", ")})
            </option>
          ))}
        </select>
        <p className="small muted" style={{ margin: 0 }}>
          Students launching from the LMS must be in a batch or section the assignment targets.{" "}
          <Link href="/console/assignments">Create an assignment</Link> first if you need a new one.
        </p>
        {error && <ErrorBox message={error} />}
        {done && <span className="pill good">Connected. Students can launch it now.</span>}
        <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={!choice || busy} onClick={save}>
          Connect
        </button>
      </div>
    </div>
  );
}

export default function LtiLinkPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Bind />
    </Suspense>
  );
}
