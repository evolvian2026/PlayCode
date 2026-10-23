// Prometheus metrics, kept in memory per API instance (scrape every
// instance). Request counts and latency by route template, so labels stay
// few; gauges that need the database are added at scrape time.

const BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const requests = new Map<string, number>();
const durations = new Map<string, { buckets: number[]; sum: number; count: number }>();

export function observeRequest(method: string, route: string, status: number, seconds: number) {
  const key = `${method}|${route}|${status}`;
  requests.set(key, (requests.get(key) ?? 0) + 1);
  const dkey = `${method}|${route}`;
  const d = durations.get(dkey) ?? { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 };
  BUCKETS.forEach((b, i) => {
    if (seconds <= b) d.buckets[i]!++;
  });
  d.sum += seconds;
  d.count++;
  durations.set(dkey, d);
}

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const labels = (l: Record<string, string>) => `{${Object.entries(l).map(([k, v]) => `${k}="${esc(v)}"`).join(",")}}`;

export interface Gauge {
  name: string;
  help: string;
  values: { labels?: Record<string, string>; value: number }[];
}

export function renderMetrics(gauges: Gauge[]): string {
  const out: string[] = [];
  out.push("# HELP playcode_http_requests_total HTTP requests by method, route and status.", "# TYPE playcode_http_requests_total counter");
  for (const [key, n] of requests) {
    const [method, route, status] = key.split("|") as [string, string, string];
    out.push(`playcode_http_requests_total${labels({ method, route, status })} ${n}`);
  }
  out.push("# HELP playcode_http_request_duration_seconds HTTP request latency.", "# TYPE playcode_http_request_duration_seconds histogram");
  for (const [key, d] of durations) {
    const [method, route] = key.split("|") as [string, string];
    BUCKETS.forEach((b, i) => out.push(`playcode_http_request_duration_seconds_bucket${labels({ method, route, le: String(b) })} ${d.buckets[i]}`));
    out.push(`playcode_http_request_duration_seconds_bucket${labels({ method, route, le: "+Inf" })} ${d.count}`);
    out.push(`playcode_http_request_duration_seconds_sum${labels({ method, route })} ${d.sum.toFixed(6)}`);
    out.push(`playcode_http_request_duration_seconds_count${labels({ method, route })} ${d.count}`);
  }
  const mem = process.memoryUsage();
  gauges.push(
    { name: "playcode_process_resident_memory_bytes", help: "Resident memory of this API process.", values: [{ value: mem.rss }] },
    { name: "playcode_process_uptime_seconds", help: "Seconds since this API process started.", values: [{ value: Math.round(process.uptime()) }] },
  );
  for (const g of gauges) {
    out.push(`# HELP ${g.name} ${g.help}`, `# TYPE ${g.name} gauge`);
    for (const v of g.values) out.push(`${g.name}${v.labels ? labels(v.labels) : ""} ${v.value}`);
  }
  return `${out.join("\n")}\n`;
}

/** Tests start from a clean slate. */
export function resetMetrics() {
  requests.clear();
  durations.clear();
}
