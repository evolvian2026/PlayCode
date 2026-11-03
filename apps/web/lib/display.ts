import type { DisplayPrefs } from "@playcode/core";

// Display settings live on the account; this device keeps a copy so pages
// open with them already applied, before the account has loaded.

const STORAGE_KEY = "playcode.display";

/** Set the settings as attributes on <html>, which globals.css styles. */
export function applyDisplay(prefs: DisplayPrefs | null | undefined) {
  const p = prefs ?? {};
  const root = document.documentElement;
  const set = (name: string, on: boolean, value = "on") => (on ? root.setAttribute(name, value) : root.removeAttribute(name));
  set("data-text", Boolean(p.textSize && p.textSize !== "normal"), p.textSize);
  set("data-font", Boolean(p.readableFont), "readable");
  set("data-motion", Boolean(p.reduceMotion), "reduce");
  set("data-contrast", Boolean(p.highContrast), "more");
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Private mode or storage blocked: the settings still apply from the account.
  }
}

/** Runs inline in <head> so a reload doesn't flash the default size first. Mirrors applyDisplay. */
export const EARLY_DISPLAY_SCRIPT = `try{var p=JSON.parse(localStorage.getItem("${STORAGE_KEY}")||"{}"),r=document.documentElement;if(p.textSize&&p.textSize!=="normal")r.setAttribute("data-text",p.textSize);if(p.readableFont)r.setAttribute("data-font","readable");if(p.reduceMotion)r.setAttribute("data-motion","reduce");if(p.highContrast)r.setAttribute("data-contrast","more")}catch(e){}`;
