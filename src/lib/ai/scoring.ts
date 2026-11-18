import type { LabelScore, WorkflowLabel } from './types.ts';
import { LABEL_ORDER } from './types.ts';
import { calibrateConfidence, similaritiesToDistribution } from './classifier.ts';
import { combineSegmentScores, splitIntoSegments } from './segments.ts';

/**
 * Shared scoring pipeline for the embedding model.
 *
 * Both the browser worker and the Node evaluation runner call this function,
 * so the numbers reported in the Evaluation Lab are the numbers the
 * command line reports. Any change to the scoring behaviour has to happen
 * here, once.
 */

/** Minimal vector contract, so this module does not depend on a runtime. */
export type Vector = number[];

/** Cosine similarity between two vectors. */
export function cosine(a: Vector, b: Vector): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

export interface ModelScoringInput {
  /** Prototypes per label. */
  prototypes: Record<WorkflowLabel, string[]>;
  /** Label order used for the result. */
  labelOrder: WorkflowLabel[];
  /** Vectors for the record's segments. */
  segmentVectors: Vector[];
  /** Prototype vectors, grouped by label in `labelOrder`. */
  prototypeVectors: Vector[][];
}

/**
 * Group the flat prototype vectors produced by the embedding batch.
 *
 * The batch is laid out as all segments followed by all prototypes in label
 * order, so the prototype vectors have to be split back into per-label
 * groups before they can be scored.
 */
export function groupPrototypeVectors(
  vectors: Vector[],
  segmentCount: number,
  prototypeCounts: number[],
): Vector[][] {
  const groups: Vector[][] = [];
  let cursor = segmentCount;
  for (const count of prototypeCounts) {
    groups.push(vectors.slice(cursor, cursor + count));
    cursor += count;
  }
  return groups;
}

/**
 * Score a record against the label prototypes.
 *
 * A label's similarity is the best of:
 *  - the whole record matched against the label's best prototype, and
 *  - the label's best prototype matched against the record's best segment,
 *    discounted by {@link SEGMENT_MARGIN}.
 *
 * The whole-record score keeps a coherent single-statement record intact; the
 * segment score lets an acute statement buried inside a reassuring record
 * still be detected.
 */
export function scoreAgainstPrototypes(input: ModelScoringInput): LabelScore[] {
  const { segmentVectors, prototypeVectors, labelOrder } = input;

  return labelOrder.map((label, labelIndex) => {
    const labelPrototypeVectors = prototypeVectors[labelIndex] ?? [];
    let whole = -1;
    let bestSegment = -1;

    for (const prototypeVector of labelPrototypeVectors) {
      // The first segment vector is the whole record.
      const wholeVector = segmentVectors[0];
      if (wholeVector) {
        const similarity = cosine(wholeVector, prototypeVector);
        if (similarity > whole) whole = similarity;
      }

      for (const segmentVector of segmentVectors) {
        const similarity = cosine(segmentVector, prototypeVector);
        if (similarity > bestSegment) bestSegment = similarity;
      }
    }

    const similarity =
      whole === -1 ? 0 : bestSegment === -1 ? whole : combineSegmentScores(whole, bestSegment);

    return {
      label,
      score: Number(((similarity + 1) / 2).toFixed(4)),
      similarity: Number(similarity.toFixed(4)),
    };
  });
}

/**
 * Build the batch of strings to embed for a record.
 *
 * The order is significant: the segment vectors come first, followed by the
 * prototype vectors. {@link scoreAgainstPrototypes} relies on that layout.
 */
export function buildEmbeddingBatch(
  text: string,
  prototypes: Record<WorkflowLabel, string[]>,
  labelOrder: WorkflowLabel[],
): { segments: string[]; batch: string[]; prototypeCounts: number[] } {
  const segments = splitIntoSegments(text);
  const batch = [...segments];
  const prototypeCounts: number[] = [];

  for (const label of labelOrder) {
    const labelPrototypes = prototypes[label] ?? [label];
    prototypeCounts.push(labelPrototypes.length);
    batch.push(...labelPrototypes);
  }

  return { segments, batch, prototypeCounts };
}

/**
 * Calibrate raw scores into the distribution and confidence the decision
 * layer consumes.
 */
export function calibrate(scores: LabelScore[]): {
  distribution: LabelScore[];
  confidence: number;
} {
  const distribution = similaritiesToDistribution(scores);
  return { distribution, confidence: calibrateConfidence(distribution) };
}

/** Reorder scores into the canonical label order. */
export function orderScores(scores: LabelScore[]): LabelScore[] {
  return LABEL_ORDER.map((label) => scores.find((score) => score.label === label)).filter(
    (score): score is LabelScore => Boolean(score),
  );
}
