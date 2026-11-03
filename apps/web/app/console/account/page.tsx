"use client";

import { useMe } from "@/components/Auth";
import { DisplayCard } from "@/components/DisplayCard";
import { DevicesCard, TwoFactorCard } from "@/components/SecurityPanel";

export default function Account() {
  const me = useMe();
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 760 }}>
      <div>
        <h1 style={{ margin: 0 }}>Your account</h1>
        <p className="muted" style={{ margin: 0 }}>
          {me.user.name} · {me.user.email}
        </p>
      </div>
      {me.mfaSetupRequired && (
        <div className="error" role="alert">
          Your institution requires two-factor sign-in for staff. Set it up below to use the console.
        </div>
      )}
      <TwoFactorCard onEnabled={() => me.mfaSetupRequired && window.location.assign("/console")} />
      <DevicesCard />
      <DisplayCard />
    </div>
  );
}
