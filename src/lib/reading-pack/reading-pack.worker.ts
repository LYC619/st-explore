import { isReadingPackError, parseReadingPackBytes } from './import';
import type { ReadingPackWorkerRequest, ReadingPackWorkerResponse } from './reading-pack-worker-client';

self.onmessage = (event: MessageEvent<ReadingPackWorkerRequest>) => {
  const { type, requestId, buffer } = event.data;
  if (type !== 'parse') return;
  let response: ReadingPackWorkerResponse;
  try {
    response = { type: 'parsed', requestId, parsed: parseReadingPackBytes(new Uint8Array(buffer)) };
  } catch (error) {
    response = {
      type: 'error', requestId,
      code: isReadingPackError(error) ? error.code : 'invalid-format',
      message: isReadingPackError(error) ? error.message : error instanceof Error ? error.message : String(error),
    };
  }
  self.postMessage(response);
};
