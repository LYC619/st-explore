import { loadPinnedSource, recordSourceManifest } from './source.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--verify-only') {
    const source = await loadPinnedSource();
    console.log(`Tavern: verified ${source.manifest.files.length} original files at ${source.provenance.commit}.`);
  } else if (args.length === 1 && args[0] === '--record-source') {
    const manifest = await recordSourceManifest();
    console.log(`Tavern: recorded ${manifest.files.length} original files; review provenance before committing.`);
  } else if (args.length === 0) {
    const { prepareTavern } = await import('./build.mjs');
    const result = await prepareTavern();
    console.log(`Tavern: ${result.reused ? 'verified cached' : 'built'} ${result.manifest.files.length} bundle assets; ${result.assets.size} served assets.`);
  } else {
    throw new Error('Usage: node scripts/tavern/prepare.mjs [--verify-only | --record-source]');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
