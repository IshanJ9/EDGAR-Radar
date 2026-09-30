/**
 * Build-time guard that the embedding model still produces the similarities
 * risk-factor diffing expects. Runs in the Docker build right after
 * warmModelCache, so an image whose embeddings have drifted never builds -
 * and so never deploys.
 *
 * Why a script and not a Jest test: the unit suite never loads the model
 * (the nock guard in jest.setup.ts blocks the Hugging Face download, on
 * purpose), so riskFactorDiff.test.ts and riskFactors.test.ts pass whatever
 * the embedding library does. The Docker build is the one place where the
 * real, baked-in model is always present.
 *
 * `expected` is the fp32 output of @huggingface/transformers 4.3.0, recorded
 * 2026-10-01 when it replaced @xenova/transformers. It was identical to six
 * decimal places on x64 and on emulated ARM64 (the production VM's
 * architecture). `previous` is what the old library's quantized model gave
 * for the same pair on x64 - kept to record how far the migration moved
 * scores (up to 0.022), not checked against. The pairs span both
 * riskFactorDiff thresholds: a near-duplicate above 0.92, pairs around the
 * 0.60 'modified' line, and unrelated pairs well below it.
 *
 * TOLERANCE is tight because fp32 does not vary by CPU the way the int8
 * kernels did; anything past it means the weights, library or runtime
 * changed, which should be a deliberate, re-measured decision.
 */
import { cosineSimilarity, embedTexts } from '../src/embeddings';

const TOLERANCE = 0.001;

const REFERENCE_PAIRS: ReadonlyArray<{ a: string; b: string; expected: number; previous: number }> = [
  {
    a: 'Our revenue depends on a small number of customers.',
    b: 'Our revenues depend on a small number of customers.',
    expected: 0.954212,
    previous: 0.946029,
  },
  {
    a: 'We depend on a limited number of suppliers for key components.',
    b: 'Our business relies on a small number of suppliers for critical parts.',
    expected: 0.722723,
    previous: 0.700253,
  },
  {
    a: 'Changes in interest rates could adversely affect our results of operations.',
    b: 'Fluctuations in interest rates may harm our financial results.',
    expected: 0.752224,
    previous: 0.733425,
  },
  {
    a: 'Cybersecurity incidents could disrupt our operations and damage our reputation.',
    b: 'A breach of our information systems could interrupt our business.',
    expected: 0.657331,
    previous: 0.642012,
  },
  {
    a: 'We face intense competition in the markets in which we operate.',
    b: 'Our stock price may be volatile.',
    expected: 0.443041,
    previous: 0.447122,
  },
  {
    a: 'Climate change regulation may increase our compliance costs.',
    b: 'The loss of key personnel could harm our business.',
    expected: 0.237775,
    previous: 0.241378,
  },
];

async function main(): Promise<void> {
  let worst = 0;
  const failures: string[] = [];

  for (const { a, b, expected } of REFERENCE_PAIRS) {
    const [va, vb] = await embedTexts([a, b]);
    if (!va || !vb || va.length !== 384 || vb.length !== 384) {
      throw new Error(`Expected two 384-dimension vectors, got ${va?.length ?? 'nothing'} and ${vb?.length ?? 'nothing'}.`);
    }
    const actual = cosineSimilarity(va, vb);
    const diff = Math.abs(actual - expected);
    worst = Math.max(worst, diff);
    const line = `expected ${expected.toFixed(6)}, got ${actual.toFixed(6)} (diff ${diff.toFixed(6)})`;
    console.log(line);
    if (diff > TOLERANCE) failures.push(`"${a}" / "${b}": ${line}`);
  }

  if (failures.length > 0) {
    throw new Error(`Embedding similarities drifted beyond ${TOLERANCE}:\n${failures.join('\n')}`);
  }
  console.log(`Embeddings OK: ${REFERENCE_PAIRS.length} pairs, worst diff ${worst.toFixed(6)} (tolerance ${TOLERANCE}).`);
}

main().catch((error) => {
  console.error('Embedding check failed:', error);
  process.exit(1);
});
