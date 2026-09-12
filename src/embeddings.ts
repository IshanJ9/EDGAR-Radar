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
 * Model: Xenova/all-MiniLM-L6-v2 - a small (~90MB), fast, widely-used
 * sentence-embedding model, 384 dimensions, truncates around 256 tokens
 * per input (why callers should chunk text before embedding it).
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
