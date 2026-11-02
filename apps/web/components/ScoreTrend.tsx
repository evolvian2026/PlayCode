"use client";

/** Adaptive test scores over time, oldest first: official ones filled, practice ones hollow, with the band lines behind. */
export function ScoreTrend({ points, label, bandLines, dateLabel }: { points: { at: string; score: number; official: boolean }[]; label: string; bandLines: { at: number; label: string }[]; dateLabel: (at: string) => string }) {
  // Sized for a phone, where it is drawn about this wide, so the labels stay readable.
  const W = 360, H = 170, left = 34, right = 70, top = 10, bottom = 22;
  const scores = points.map((p) => p.score);
  const lo = Math.floor(Math.min(350, ...scores) / 50) * 50;
  const hi = Math.ceil(Math.max(700, ...scores) / 50) * 50;
  const x = (i: number) => left + (points.length === 1 ? 0 : (i * (W - left - right)) / (points.length - 1));
  const y = (v: number) => top + (H - top - bottom) * (1 - (v - lo) / (hi - lo));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ width: "100%", maxWidth: 520, height: "auto" }}>
      {bandLines
        .filter((b) => b.at > lo && b.at < hi)
        .map((b) => (
          <g key={b.at}>
            <line x1={left} x2={W - right + 8} y1={y(b.at)} y2={y(b.at)} stroke="var(--border)" strokeDasharray="4 4" />
            <text x={W - right + 10} y={y(b.at) + 4} fontSize="11" fill="var(--muted)">
              {b.label}
            </text>
          </g>
        ))}
      {[lo, hi].map((v) => (
        <text key={v} x={left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
          {v}
        </text>
      ))}
      <polyline points={points.map((p, i) => `${x(i)},${y(p.score)}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <title>{`${dateLabel(p.at)}: ${p.score}`}</title>
          <circle cx={x(i)} cy={y(p.score)} r={p.official ? 5.5 : 4} fill={p.official ? "var(--accent)" : "var(--surface)"} stroke="var(--accent)" strokeWidth="2" />
        </g>
      ))}
      {[0, points.length - 1].map((i) => (
        <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : "end"} fontSize="11" fill="var(--muted)">
          {dateLabel(points[i]!.at)}
        </text>
      ))}
    </svg>
  );
}
