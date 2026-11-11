/**
 * Plays the games of one evaluation under a given balance. This is the unit of
 * work the tuner farms out: it runs in the main thread for `npm run sim`, and
 * in worker threads (this same file) for `npm run tune`.
 */
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { setBalance, type Balance } from '../src/game/balance.ts';
import { STYLES } from './mayor.ts';
import { simulate } from './run.ts';
import type { Job, Result } from './targets.ts';

export function evaluate(balance: Balance, jobs: readonly Job[]): Result[] {
  setBalance(balance);
  return jobs.map(job => ({ ...job, summary: simulate(job.seed, STYLES[job.style], job.years).summary }));
}

type Task = { id: number; balance: Balance; jobs: readonly Job[] };
type Reply = { id: number; results: Result[] };

if (!isMainThread) {
  parentPort!.on('message', (task: Task) => {
    const reply: Reply = { id: task.id, results: evaluate(task.balance, task.jobs) };
    parentPort!.postMessage(reply);
  });
}

/** A fixed set of worker threads, each playing one game at a time. */
export class Pool {
  private readonly idle: Worker[] = [];
  private readonly waiting: (() => void)[] = [];
  private readonly pending = new Map<number, (results: Result[]) => void>();
  private nextId = 0;
  private readonly workers: Worker[] = [];

  constructor(size: number) {
    for (let n = 0; n < size; n++) {
      const worker = new Worker(new URL(import.meta.url));
      worker.on('message', (reply: Reply) => {
        this.pending.get(reply.id)!(reply.results); this.pending.delete(reply.id);
        this.idle.push(worker); this.waiting.shift()?.();
      });
      worker.on('error', error => { throw error; });
      this.workers.push(worker); this.idle.push(worker);
    }
  }

  private async run(balance: Balance, job: Job): Promise<Result> {
    while (this.idle.length === 0) await new Promise<void>(resolve => this.waiting.push(resolve));
    const worker = this.idle.pop()!, id = this.nextId++;
    const results = await new Promise<Result[]>(resolve => { this.pending.set(id, resolve); worker.postMessage({ id, balance, jobs: [job] } satisfies Task); });
    return results[0];
  }

  /** Plays every job under `balance`, spread over the workers. */
  evaluate(balance: Balance, jobs: readonly Job[]) { return Promise.all(jobs.map(job => this.run(balance, job))); }

  async close() { await Promise.all(this.workers.map(worker => worker.terminate())); }
}
