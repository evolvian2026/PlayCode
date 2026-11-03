// Display preferences a user can set for themselves; the web app applies them
// as attributes on the page root, and they follow the account across devices.

export interface DisplayPrefs {
  /** Text size: normal, or about an eighth or a quarter larger. */
  textSize?: "normal" | "large" | "larger";
  /** A plainer, wider font with more spacing, which many readers with dyslexia find easier. */
  readableFont?: boolean;
  /** Turn off animations and transitions. */
  reduceMotion?: boolean;
  /** Darker secondary text and stronger borders. */
  highContrast?: boolean;
}

export const TEXT_SIZES = ["normal", "large", "larger"] as const;
