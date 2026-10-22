"use client";

/** Code with line numbers. With `onLineClick`, lines become tappable (spot the bug). */
export function CodeBlock({
  code,
  lineClass,
  onLineClick,
  label,
}: {
  code: string;
  lineClass?: (line: number) => string;
  onLineClick?: (line: number) => void;
  label?: string;
}) {
  const lines = code.split("\n");
  return (
    <div className="code" role={onLineClick ? "listbox" : undefined} aria-label={label ?? "Code"} aria-multiselectable={onLineClick ? true : undefined}>
      {lines.map((text, i) => {
        const n = i + 1;
        const cls = `line${onLineClick ? " selectable" : ""} ${lineClass?.(n) ?? ""}`;
        return onLineClick ? (
          <div
            key={n}
            className={cls}
            role="option"
            aria-selected={lineClass?.(n).includes("picked") ?? false}
            tabIndex={0}
            onClick={() => onLineClick(n)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onLineClick(n);
              }
            }}
          >
            <span className="ln">{n}</span>
            {text || " "}
          </div>
        ) : (
          <div key={n} className={cls}>
            <span className="ln">{n}</span>
            {text || " "}
          </div>
        );
      })}
    </div>
  );
}
