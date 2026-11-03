"use client";

/** Daily active students for the last 14 days, as bars. Days with no activity show as gaps at zero. */
export function ActivityChart({
  daily,
  total,
  today,
  timeZone,
}: {
  daily: { day: string; activeStudents: number; answers: number }[];
  total: number;
  today: Date;
  timeZone: string;
}) {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today.getTime() - (13 - i) * 86_400_000);
    const key = d.toLocaleDateString("en-CA", { timeZone });
    return { key, label: d.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone }), active: byDay.get(key)?.activeStudents ?? 0, answers: byDay.get(key)?.answers ?? 0 };
  });
  const max = Math.max(1, total);
  const W = 640, H = 180, left = 32, bottom = 24, top = 8;
  const bw = (W - left) / days.length;
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  const ticks = [0, Math.round(max / 2), max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily active students, last 14 days" style={{ width: "100%", height: "auto" }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W} y1={y(t)} y2={y(t)} stroke="var(--border)" />
          <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
            {t}
          </text>
        </g>
      ))}
      {days.map((d, i) => (
        <g key={d.key}>
          <title>{`${d.label}: ${d.active} active students, ${d.answers} answers`}</title>
          <rect x={left + i * bw + 4} y={y(d.active)} width={bw - 8} height={Math.max(0, H - bottom - y(d.active))} rx="4" fill="var(--accent)" />
          {i % 2 === 1 && (
            <text x={left + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">
              {d.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
