"use client";

import { useState } from "react";
import { TEXT_SIZES, type DisplayPrefs } from "@playcode/core";
import { useMe } from "@/components/Auth";
import { ErrorBox } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { applyDisplay } from "@/lib/display";
import { useT } from "@/lib/i18n";

const SIZE_LABELS: Record<(typeof TEXT_SIZES)[number], string> = { normal: "Normal", large: "Large", larger: "Larger" };
const TOGGLES: { key: "readableFont" | "reduceMotion" | "highContrast"; label: string; hint: string }[] = [
  { key: "readableFont", label: "Easier-to-read font", hint: "A plainer font with more space between letters and lines" },
  { key: "reduceMotion", label: "Reduce motion", hint: "Turn off animations" },
  { key: "highContrast", label: "Higher contrast", hint: "Darker text and stronger outlines" },
];

/** Text size, font, motion and contrast. Saved to the account, so they follow you to other devices. */
export function DisplayCard() {
  const t = useT();
  const me = useMe();
  const [prefs, setPrefs] = useState<DisplayPrefs>(me.user.display ?? {});
  const [error, setError] = useState<string | null>(null);

  async function save(change: DisplayPrefs) {
    const before = prefs;
    const next = { ...prefs, ...change };
    // Apply straight away so the change is visible, and undo it if saving fails.
    setPrefs(next);
    applyDisplay(next);
    setError(null);
    try {
      await api("/me/display", { method: "PUT", body: change });
    } catch (e) {
      setPrefs(before);
      applyDisplay(before);
      setError(errorMessage(e));
    }
  }

  const size = prefs.textSize ?? "normal";
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{t("Display")}</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {t("Make PlayCode easier to read. Saved to your account, so it applies on every device you sign in on.")}
      </p>
      <div className="stack" style={{ gap: 6 }} role="group" aria-labelledby="display-size">
        <span id="display-size" style={{ fontWeight: 500 }}>
          {t("Text size")}
        </span>
        <div className="row">
          {TEXT_SIZES.map((s) => (
            <button key={s} className={`btn small ${s === size ? "primary" : ""}`} aria-pressed={s === size} onClick={() => s !== size && save({ textSize: s })}>
              {t(SIZE_LABELS[s])}
            </button>
          ))}
        </div>
      </div>
      {TOGGLES.map((x) => (
        <label key={x.key} className="row" style={{ fontWeight: 500, gap: 8, alignItems: "flex-start" }}>
          <input type="checkbox" checked={Boolean(prefs[x.key])} onChange={(e) => save({ [x.key]: e.target.checked })} style={{ width: "auto", marginTop: 4 }} />
          <span>
            {t(x.label)}
            <span className="small muted" style={{ display: "block", fontWeight: 400 }}>
              {t(x.hint)}
            </span>
          </span>
        </label>
      ))}
      {error && <ErrorBox message={error} />}
    </div>
  );
}
