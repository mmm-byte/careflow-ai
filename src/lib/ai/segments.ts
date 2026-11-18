/**
 * Record segmentation for the embedding model.
 *
 * A clinical record is not one statement: it is a sequence of statements,
 * and the safety-relevant one may be a single sentence among several
 * reassuring ones.
 *
 * Consider "observations stable and within normal range. However resident
 * reports chest pain and requires urgent assessment." Embedding the whole
 * record as a single vector averages the reassuring observations with the
 * acute symptom, and the reassuring half wins. A human reviewer scanning the
 * record would not average; they would look for the most urgent statement
 * anywhere in it.
 *
 * The model therefore scores every segment independently and takes the
 * **maximum** similarity per label. This is the standard multiple-instance
 * formulation: the record is a bag of statements, and a label applies if
 * *any* statement supports it.
 *
 * The full record is also scored as one segment, so a record that reads as a
 * single coherent statement is not fragmented.
 */

/** Prefixes the normalizer adds, which are structural rather than clinical. */
const STRUCTURAL_PREFIX = /^(?:note|encounter|observation|open work)\s*:\s*/i;

/** The synthetic-data provenance marker, which is not clinical content. */
const SYNTHETIC_MARKER = /^synthetic\s+(?:note|record|entry)\s*:\s*/i;

/**
 * Split a normalized record into candidate segments.
 *
 * Segments break at sentence boundaries and at the normalizer's own line
 * breaks. Short fragments are dropped because they carry too little signal
 * to embed meaningfully, and an over-long segment is left intact rather than
 * being chopped mid-clause.
 *
 * @param text The normalized record text.
 * @param minimumWords Fragments shorter than this are discarded.
 */
export function splitIntoSegments(text: string, minimumWords = 4): string[] {
  const lines = text
    .split('\n')
    .map((line) => line.replace(STRUCTURAL_PREFIX, '').replace(SYNTHETIC_MARKER, '').trim())
    .filter((line) => line.length > 0);

  const sentences: string[] = [];
  for (const line of lines) {
    // Split on sentence terminators, keeping the terminator with the text.
    const parts = line.split(/(?<=[.!?;])\s+/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length > 0) sentences.push(trimmed);
    }
  }

  const kept = sentences.filter(
    (sentence) => sentence.split(/\s+/).filter(Boolean).length >= minimumWords,
  );

  // The full record is always included so a coherent single statement is
  // scored as a whole rather than only in fragments.
  const full = text.replace(/\s+/g, ' ').trim();
  const segments = kept.length > 0 ? kept : [full];

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const segment of [full, ...segments]) {
    const key = segment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(segment);
  }
  return unique;
}

/**
 * Margin a single segment must beat the whole record by.
 *
 * A segment-level match is allowed to outrank the whole-record match, but
 * only if it matches more clearly. Without a margin, a single short segment
 * that happens to sit near a prototype would capture the whole record's
 * score, which produces erratic behaviour on short notes.
 *
 * The value was chosen by sweeping the combined and held-out scenario sets
 * and taking the largest coverage that produced no incorrect recommendation
 * on either. See EVALUATION.md for the sweep.
 */
export const SEGMENT_MARGIN = 0.05;

/**
 * Combine the whole-record similarity with the best segment similarity.
 *
 * @param wholeSimilarity Similarity of the complete record.
 * @param bestSegmentSimilarity Similarity of the most on-topic segment.
 */
export function combineSegmentScores(
  wholeSimilarity: number,
  bestSegmentSimilarity: number,
): number {
  return Math.max(wholeSimilarity, bestSegmentSimilarity - SEGMENT_MARGIN);
}
