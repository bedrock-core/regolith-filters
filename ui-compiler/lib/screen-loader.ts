import { Worker } from 'node:worker_threads';
import type { LoadScreenOptions, ScreenBundle } from './load.ts';

type ScreenData = Pick<ScreenBundle, 'kind' | 'compiled'>;

/** Bounds the module cache while compiling a catalog against the addon's own libraries. */
export class ScreenDataLoader {
  private worker?: Worker;
  private count = 0;
  private pending = false;
  private readonly batchSize: number;

  constructor(batchSize = 64) {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1) { throw new Error('Screen batch size must be a positive integer'); }

    this.batchSize = batchSize;
  }

  async load(options: LoadScreenOptions): Promise<ScreenData> {
    if (this.pending) { throw new Error('Screen compilation is sequential'); }
    this.pending = true;

    try {
      if (this.count >= this.batchSize) { await this.close(); }

      const worker = this.worker ??= new Worker(new URL('./screen-worker.ts', import.meta.url));

      return await new Promise<ScreenData>((resolve, reject) => {
        const cleanup = (): void => {
          worker.off('message', message);
          worker.off('error', error);
          worker.off('exit', exit);
        };
        const message = (response: { value?: string; error?: Error }): void => {
          cleanup();

          if (response.error) { reject(response.error); }
          else if (typeof response.value === 'string') {
            try { resolve(JSON.parse(response.value) as ScreenData); }
            catch (reason) { reject(reason); }
          }
          else { reject(new Error('Screen worker returned no compilation result')); }
        };
        const error = (reason: Error): void => { cleanup(); reject(reason); };
        const exit = (code: number): void => { cleanup(); reject(new Error(`Screen worker exited before returning a result (${code})`)); };

        worker.once('message', message);
        worker.once('error', error);
        worker.once('exit', exit);
        worker.postMessage(options);
      });
    } finally {
      this.count++;
      this.pending = false;
    }
  }

  async close(): Promise<void> {
    const worker = this.worker;

    this.worker = undefined;
    this.count = 0;

    await worker?.terminate();
  }
}
