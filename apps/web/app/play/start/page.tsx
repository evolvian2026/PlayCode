"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { startAndOpen } from "@/lib/start";

// Deep link into an assignment (used by LMS launches): start or resume it and open the player.
function Start() {
  const router = useRouter();
  const assignmentId = useSearchParams().get("assignment");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!assignmentId) {
      router.replace("/play");
      return;
    }
    void startAndOpen({ kind: "assignment", assignmentId }, router.replace).then(setError);
  }, [assignmentId, router]);
  if (!error) return <Loading label="Opening your assignment" />;
  return (
    <div className="stack">
      <ErrorBox message={error} />
      <Link className="btn" href="/play">
        Go to PlayCode home
      </Link>
    </div>
  );
}

export default function StartPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Start />
    </Suspense>
  );
}
