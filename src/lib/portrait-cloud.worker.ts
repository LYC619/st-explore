import { processPortraitImport, type PortraitImportRequest } from './portrait-import-parser';
self.onmessage = ({ data }: MessageEvent<PortraitImportRequest>) => {
  try { const result = processPortraitImport(data); self.postMessage({ result, links: result.items }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
