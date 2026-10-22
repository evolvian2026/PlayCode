// In-process priority pool: assessments first, then duels, then practice.
// One API instance runs at most `concurrency` programs at a time. When the
// API runs as several instances, move this to a shared queue (BullMQ/SQS).

export type Priority = "assessment" | "duel" | "practice";
const RANK: Record<Priority, number> = { assessment: 0, duel: 1, practice: 2 };

interface Job {
  rank: number;
  seq: number;
  start: () => void;
}

export class ExecutionQueue {
  private running = 0;
  private waiting: Job[] = [];
  private seq = 0;

  constructor(private concurrency: number) {}

  get depth(): number {
    return this.waiting.length;
  }

  run<T>(priority: Priority, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.running++;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.running--;
            this.next();
          });
      };
      this.waiting.push({ rank: RANK[priority], seq: this.seq++, start });
      this.waiting.sort((a, b) => a.rank - b.rank || a.seq - b.seq);
      this.next();
    });
  }

  private next(): void {
    while (this.running < this.concurrency && this.waiting.length) this.waiting.shift()!.start();
  }
}
