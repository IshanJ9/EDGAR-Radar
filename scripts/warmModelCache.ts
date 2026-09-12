/**
 * Downloads and caches the sentence-embedding model weights, so a Docker
 * image can bake them in at BUILD time instead of fetching them at runtime.
 *
 * Why this exists: `@xenova/transformers` lazily downloads the model on
 * first use into `node_modules/@xenova/transformers/.cache`. In a container
 * that directory is ephemeral, so without this step every container recreate
 * would re-download ~23MB, the first risk-factor diff request would block on
 * that download, and the API could not produce a diff at all without
 * outbound network access to Hugging Face.
 *
 * It deliberately calls the real `embedTexts()` rather than reaching for the
 * transformers API directly: that guarantees the weights cached here are
 * exactly the ones production loads (same model id, same quantized build),
 * so this can never silently warm the wrong cache entry.
 */
import { embedTexts } from '../src/embeddings';

async function main(): Promise<void> {
  console.log('Warming embedding model cache (Xenova/all-MiniLM-L6-v2)...');
  const started = Date.now();
  const [vector] = await embedTexts(['warm the model cache']);
  if (!vector || vector.length !== 384) {
    throw new Error(`Model cache warm failed: expected a 384-dimension vector, got ${vector?.length ?? 'nothing'}.`);
  }
  console.log(`Model cache warmed in ${((Date.now() - started) / 1000).toFixed(1)}s (${vector.length} dimensions).`);
}

main().catch((error) => {
  console.error('Failed to warm the embedding model cache:', error);
  process.exit(1);
});
