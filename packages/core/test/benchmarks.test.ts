import { describe, expect, it } from "vitest";
import { BENCHMARK_MIN_PEERS, compareWithPeers, quantile, type BenchmarkValues } from "../src";

const v = (n: number): BenchmarkValues => ({ serviceReadiness: n, productReadiness: n / 2, weeklyActivePct: n, answersPerActive: n / 10 });

describe("peer benchmarks", () => {
  it("interpolates quantiles", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10, 20, 30, 40, 50], 0.75)).toBe(40);
    expect(quantile([], 0.5)).toBe(0);
  });

  it("shows nothing with too few peers", () => {
    expect(compareWithPeers(v(50), Array.from({ length: BENCHMARK_MIN_PEERS - 1 }, (_, i) => v(i * 10)))).toBeNull();
  });

  it("gives the median, top quartile and a coarse percentile", () => {
    const rows = compareWithPeers(v(55), [10, 20, 30, 40, 50, 60, 70, 80].map(v))!;
    const service = rows.find((r) => r.metric === "serviceReadiness")!;
    expect(service).toEqual({ metric: "serviceReadiness", value: 55, peerMedian: 45, peerTopQuartile: 62.5, percentile: 60 });
    // Ties count half, and the percentile is rounded down to tens.
    expect(compareWithPeers(v(10), [10, 10, 10, 10, 10].map(v))![0]!.percentile).toBe(50);
    expect(compareWithPeers(v(99), [10, 20, 30, 40, 50].map(v))![0]!.percentile).toBe(100);
  });
});
