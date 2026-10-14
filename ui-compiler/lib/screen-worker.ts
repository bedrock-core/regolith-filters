import { parentPort } from 'node:worker_threads';
import { loadScreen, type LoadScreenOptions } from './load.ts';

if (!parentPort) { throw new Error('Screen compilation requires a worker port'); }

const port = parentPort;

port.on('message', async (options: LoadScreenOptions) => {
  try {
    const { kind, compiled } = await loadScreen(options);

    // Pack linking consumes JSON data; runtime handlers belong to the addon sources.
    port.postMessage({ value: JSON.stringify({ kind, compiled }) });
  } catch (error) {
    port.postMessage({ error: error instanceof Error ? error : new Error(String(error)) });
  }
});
