import { buildPortraitLinks, type PortraitLinkRules } from './portrait-cloud';
self.onmessage = ({ data }: MessageEvent<PortraitLinkRules>) => {
  try { self.postMessage({ links: buildPortraitLinks(data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
