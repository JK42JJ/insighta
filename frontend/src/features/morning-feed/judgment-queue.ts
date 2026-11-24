/*
 * Judgment write queue (SPEC M9): the screen moves on at once, saving happens behind it.
 * Failed writes stay queued (also across a reload), are retried with a growing wait, and are
 * flushed again when the network or the tab comes back. An undo that meets a judgment that was
 * never sent just removes it.
 */
export type QueueOp =
  | {
      kind: 'judge';
      body: {
        video_id: string;
        cell: string;
        verdict: 'useful' | 'skip' | 'pass';
        shown_position: number;
      };
    }
  | { kind: 'undo' };

interface QueueDeps {
  send: (op: QueueOp) => Promise<void>;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  storageKey?: string;
  /** Called after this many failed attempts in a row. */
  onTrouble?: (failures: number) => void;
  troubleAfter?: number;
}

const STORAGE_KEY = 'mf_judge_queue_v1';
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

export class JudgmentQueue {
  private items: QueueOp[] = [];
  private running = false;
  private inFlight = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: QueueDeps) {
    this.items = this.load();
  }

  get size(): number {
    return this.items.length;
  }

  enqueue(op: QueueOp): void {
    if (op.kind === 'undo') {
      const last = this.items[this.items.length - 1];
      // the judgment is still waiting and not being sent: drop it instead of writing and cancelling
      if (last && last.kind === 'judge' && !(this.inFlight && this.items.length === 1)) {
        this.items.pop();
        this.save();
        return;
      }
    }
    this.items.push(op);
    this.save();
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.running) return;
    this.running = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      while (this.items.length > 0) {
        const op = this.items[0];
        this.inFlight = true;
        try {
          await this.deps.send(op);
        } catch {
          this.inFlight = false;
          this.failures += 1;
          if (this.failures >= (this.deps.troubleAfter ?? 3)) this.deps.onTrouble?.(this.failures);
          const wait = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (this.failures - 1));
          this.timer = setTimeout(() => void this.flush(), wait);
          return;
        }
        this.inFlight = false;
        this.failures = 0;
        this.items.shift();
        this.save();
      }
    } finally {
      this.running = false;
    }
  }

  private load(): QueueOp[] {
    try {
      const raw = (this.deps.storage ?? window.localStorage).getItem(
        this.deps.storageKey ?? STORAGE_KEY
      );
      const parsed = raw ? (JSON.parse(raw) as QueueOp[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      (this.deps.storage ?? window.localStorage).setItem(
        this.deps.storageKey ?? STORAGE_KEY,
        JSON.stringify(this.items)
      );
    } catch {
      /* private mode or full: the queue still works in memory */
    }
  }
}
