import { requireIsolatedNativeArtifact } from './native-test-artifact.mjs';
console.log(await requireIsolatedNativeArtifact(process.argv[2]));
