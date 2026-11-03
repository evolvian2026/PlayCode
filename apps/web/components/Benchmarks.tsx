"use client";

import { BENCHMARK_LABELS, BENCHMARK_MIN_PEERS, BENCHMARK_MIN_STUDENTS, type BenchmarkMetric } from "@playcode/core";
import { useApi } from "@/lib/api";

type Benchmark =
  | { measured: false; minStudents: number }
  | {
      measured: true;
      day: string;
      students: number;
      peerCount: number;
      rows: { metric: BenchmarkMetric; value: number; peerMedian: number; peerTopQuartile: number; percentile: number }[] | null;
    };

/** "How you compare": the institution against anonymised peers on PlayCode. */
export function Benchmarks() {
  const { data, error } = useApi<Benchmark>("/console/benchmarks");
  if (error || !data) return null;
  return (
    <div className="card stack">
      <div className="spread wrap">
        <h2 style={{ margin: 0 }}>How you compare</h2>
        {data.measured && <span className="muted small">snapshot of {new Date(`${data.day}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, whole institution</span>}
      </div>
      {!data.measured ? (
        <p className="small muted" style={{ margin: 0 }}>
          Peer comparisons start once your institution has {data.minStudents} or more students and the nightly snapshot has run.
        </p>
      ) : !data.rows ? (
        <p className="small muted" style={{ margin: 0 }}>
          Measured ({data.students} students). Comparisons appear once at least {BENCHMARK_MIN_PEERS} other institutions are measured, so no single college can be identified;
          there {data.peerCount === 1 ? "is" : "are"} {data.peerCount} so far.
        </p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Measure</th>
                  <th>You</th>
                  <th>Peer median</th>
                  <th>Peer top quarter</th>
                  <th>Ahead of</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.metric}>
                    <td>{BENCHMARK_LABELS[r.metric]}</td>
                    <td style={{ fontWeight: 700, color: r.value >= r.peerMedian ? "var(--good-ink)" : "var(--warn-ink)" }}>{r.value}</td>
                    <td>{r.peerMedian}</td>
                    <td>{r.peerTopQuartile}</td>
                    <td>{r.percentile}% of peers</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="small muted">
            Compared with {data.peerCount} other institutions on PlayCode with {BENCHMARK_MIN_STUDENTS}+ students. Only medians and quartiles are shown; no other institution can be identified.
          </div>
        </>
      )}
    </div>
  );
}
