// Peer benchmarks: how an institution compares with the others on PlayCode,
// without revealing any other institution. Only aggregates over enough peers
// are shown (median, top quartile and the institution's own percentile).

/** Institutions need this many students to be measured, so one class doesn't stand for a college. */
export const BENCHMARK_MIN_STUDENTS = 20;
/** Comparisons are shown only with at least this many peer institutions, so no single one can be inferred. */
export const BENCHMARK_MIN_PEERS = 5;

export const BENCHMARK_METRICS = ["serviceReadiness", "productReadiness", "weeklyActivePct", "answersPerActive"] as const;
export type BenchmarkMetric = (typeof BENCHMARK_METRICS)[number];
export type BenchmarkValues = Record<BenchmarkMetric, number>;

export const BENCHMARK_LABELS: Record<BenchmarkMetric, string> = {
  serviceReadiness: "Median readiness: service companies",
  productReadiness: "Median readiness: product companies",
  weeklyActivePct: "Students active this week (%)",
  answersPerActive: "Answers per active student this week",
};

/** The value at quantile q (0-1) of a list, by linear interpolation. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export interface BenchmarkRow {
  metric: BenchmarkMetric;
  value: number;
  peerMedian: number;
  peerTopQuartile: number;
  /** Share of peers this institution is ahead of, rounded down to a multiple of 10 so it can't pin down a peer. */
  percentile: number;
}

/**
 * Compare one institution's values with its peers' (the others, not including
 * itself). Null when there are too few peers to show anything.
 */
export function compareWithPeers(own: BenchmarkValues, peers: BenchmarkValues[]): BenchmarkRow[] | null {
  if (peers.length < BENCHMARK_MIN_PEERS) return null;
  const round = (n: number) => Math.round(n * 10) / 10;
  return BENCHMARK_METRICS.map((metric) => {
    const values = peers.map((p) => p[metric]);
    const below = values.filter((v) => v < own[metric]).length + values.filter((v) => v === own[metric]).length / 2;
    return {
      metric,
      value: round(own[metric]),
      peerMedian: round(quantile(values, 0.5)),
      peerTopQuartile: round(quantile(values, 0.75)),
      percentile: Math.floor(((below / values.length) * 100) / 10) * 10,
    };
  });
}
