/**
 * Local, in-process sentence embeddings via @huggingface/transformers
 * (transformers.js), running entirely offline with no API key and no
 * external network calls at runtime (only the model weights are downloaded
 * once, on first use, and cached locally). Chosen over a hosted embeddings
 * API specifically because the user wanted a genuinely free option - see
 * PROGRESS.md for the full reasoning.
 *
 * This was `@xenova/transformers` until 2026-10-01. That package is no longer
 * maintained, and its pinned onnxruntime-web/sharp carried protobufjs and
 * libvips advisories npm could never clear. @huggingface/transformers is its
 * maintained successor, with the same API and model format. Its output was
 * compared against the old library's, not assumed - see
 * scripts/checkEmbeddings.ts and PROGRESS.md.
 *
 * Loaded via dynamic `import()` so it works from this project's
 * CommonJS/ts-node setup without a build-wide module-format change.
 *
 * Model: Xenova/all-MiniLM-L6-v2 - a small, fast, widely-used
 * sentence-embedding model (BertModel, 6 layers, 384 dimensions).
 *
 * Two details here were wrong in an earlier version of this comment and were
 * corrected only after being measured directly, so they are recorded with
 * their evidence rather than restated from memory:
 *
 * - Weights: this loads the full-precision build (`model.onnx`, ~90MB),
 *   set explicitly with `dtype: 'fp32'` below. Until 2026-10-01 it loaded the
 *   *quantized* build (`model_quantized.onnx`, 22.9MB), which
 *   `@xenova/transformers` used by default. Quantization cost accuracy:
 *   measured against fp32 over real risk-factor-style sentences, it moved
 *   pairwise cosine similarity by up to 0.0245, most in the 0.34-0.70
 *   mid-range, where riskFactorDiff's 0.60 'modified' threshold sits. Its
 *   int8 kernels also gave different results on different CPUs: under
 *   emulated ARM64 (the production VM's architecture) similarities moved by
 *   up to 0.031 from x64, while fp32 gave identical results on both. fp32 was
 *   chosen for that reason when migrating libraries; it costs ~67MB of image
 *   size and slower inference. Scores are up to ~0.022 away from the old
 *   quantized ones (see PROGRESS.md).
 *
 * - Truncation: 512 tokens, NOT 256. Verified by appending a distinctive
 *   tail to prefixes of known token length and finding where it stops
 *   changing the embedding: at a 512-token prefix the tail still moved
 *   similarity (0.996725), at 522 it was ignored entirely (1.000000). The
 *   256 figure comes from sentence-transformers' `sentence_bert_config.json`
 *   `max_seq_length`, which transformers.js does not apply; the model's own
 *   config reports `max_position_embeddings`/`model_max_length` of 512.
 *   Callers must still chunk, just against a 512-token ceiling.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- @huggingface/transformers's pipeline() return type is dynamically resolved (it's behind a runtime `await import()`, not a static import) and task-keyed; not worth threading its real generic through this module's one lazy-singleton boundary.
let embedderPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same reason as embedderPromise above.
async function getEmbedder(): Promise<any> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      return pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' });
    })();
  }
  return embedderPromise;
}

/** Embeds each text independently, returning L2-normalized vectors (so cosine similarity = dot product). */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const embedder = await getEmbedder();
  const vectors: number[][] = [];
  for (const text of texts) {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    vectors.push(Array.from(output.data as Float32Array));
  }
  return vectors;
}

/** Vectors from `embedTexts` are already L2-normalized, so the dot product alone equals cosine similarity. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}
