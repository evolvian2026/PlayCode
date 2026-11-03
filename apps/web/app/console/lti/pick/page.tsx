"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

// LTI deep linking: a teacher adding PlayCode to an LMS course picks the
// assignments here; the signed choice is posted straight back to the LMS.
function Pick() {
  const id = useSearchParams().get("request") ?? "";
  const req = useApi<{ request: { id: string; platform: string; acceptMultiple: boolean } }>(id ? `/console/lti/deep-link/${id}` : null);
  const list = useApi<{ assignments: { id: string; title: string; questionCount: number; closeAt: string; units: { name: string }[] }[] }>("/console/assignments");
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (req.error) return <ErrorBox message={req.error.message} />;
  if (!req.data || !list.data) return <Loading />;
  const multiple = req.data.request.acceptMultiple;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const { returnUrl, jwt } = await api<{ returnUrl: string; jwt: string }>(`/console/lti/deep-link/${id}`, { body: { assignmentIds: chosen } });
      // The LMS expects a form post with the signed response in a field called JWT.
      const form = document.createElement("form");
      form.method = "POST";
      form.action = returnUrl;
      const field = document.createElement("input");
      field.type = "hidden";
      field.name = "JWT";
      field.value = jwt;
      form.appendChild(field);
      document.body.appendChild(form);
      form.submit();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 680 }}>
      <div>
        <h1 style={{ margin: 0 }}>Add PlayCode to your course</h1>
        <p className="muted" style={{ margin: 0 }}>
          Choose {multiple ? "one or more assignments" : "an assignment"} to place in {req.data.request.platform}. Each becomes an activity with a gradebook column;
          students open it from the course and their score goes straight to the gradebook.
        </p>
      </div>
      <div className="card stack" style={{ gap: 10 }}>
        {list.data.assignments.length === 0 && <div className="muted">No assignments yet. Create one in PlayCode first.</div>}
        {list.data.assignments.map((a) => (
          <label key={a.id} className="row" style={{ gap: 10, fontWeight: 500, alignItems: "flex-start" }}>
            <input
              type={multiple ? "checkbox" : "radio"}
              name="assignment"
              style={{ width: "auto", marginTop: 4 }}
              checked={chosen.includes(a.id)}
              onChange={(e) => setChosen(multiple ? (e.target.checked ? [...chosen, a.id] : chosen.filter((x) => x !== a.id)) : [a.id])}
            />
            <span>
              {a.title}
              <span className="small muted" style={{ display: "block" }}>
                {a.questionCount} questions · {a.units.map((u) => u.name).join(", ")} · closes {new Date(a.closeAt).toLocaleDateString()}
              </span>
            </span>
          </label>
        ))}
      </div>
      {error && <ErrorBox message={error} />}
      <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={chosen.length === 0 || busy} onClick={send}>
        {busy ? "Sending to the LMS..." : "Add to course"}
      </button>
    </div>
  );
}

export default function PickPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Pick />
    </Suspense>
  );
}
