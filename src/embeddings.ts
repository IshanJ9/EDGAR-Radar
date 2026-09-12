/**
 * Local, in-process sentence embeddings via @xenova/transformers - a pure
 * JS/WASM port of Hugging Face transformers, running entirely offline with
 * no API key and no external network calls at runtime (only the model
 * weights are downloaded once, on first use, and cached locally). Chosen
 * over a hosted embeddings API specifically because the user wanted a
 * genuinely free option - see PROGRESS.md for the full reasoning, including
 * the accepted transitive-dependency vulnerabilities in onnxruntime-web/sharp
 * (not exercised by this text-only, own-data, offline use case).
 *
 * `@xenova/transformers` is ESM-only, loaded via dynamic `import()` so it
 * works from this project's CommonJS/ts-node setup without a build-wide
 * module-format change (confirmed working - see PROGRESS.md).
 *
 * Model: Xenova/all-MiniLM-L6-v2 - a small, fast, widely-used
 * sentence-embedding model (BertModel, 6 layers, 384 dimensions).
 *
 * Two details here were wrong in an earlier version of this comment and were
 * corrected only after being measured directly, so they are recorded with
 * their evidence rather than restated from memory:
 *
 * - Size: this loads the *quantized* build (`model_quantized.onnx`, 22.9MB
 *   on disk), not the ~90MB fp32 one - `@xenova/transformers` defaults to
 *   quantized. That is not free: measured against the fp32 weights over real
 *   risk-factor-style sentences, quantization moves pairwise cosine
 *   similarity by up to 0.0245. The error is smallest where similarity is
 *   high (0.0011 on a genuine paraphrase pair) and largest in the 0.34-0.70
 *   mid-range - which is exactly where riskFactorDiff's 0.60 'modified'
 *   threshold sits. This is the measured, numeric form of the
 *   already-documented "weak pairings near the 0.60 threshold" limitation.
 *   Pass `{ quantized: false }` to `pipeline()` to trade ~67MB and slower
 *   inference for that precision back.
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
let embedderPromise: Promise<any> | null = null;

async function getEmbedder(): Promise<any> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const { pipeline } = await import('@xenova/transformers');
      return pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
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
