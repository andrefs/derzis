import type { SimpleTriple } from './types';

/**
 * Check if the direction of the triple is acceptable based on the position of head URL in the triple and branch factor.
 * If branch factor (bf) > 1 the predicate converges from subject to object.
 * If branch factor (bf) < 1 the predicate converges from object to subject.
 * If the triple has a literal object (no object field), returns true as literals cannot be used for directionality checks.
 * @param triple The triple to check.
 * @param headUrl The URL of the head resource.
 * @param bf The branch factor of the predicate.
 * @returns True if the direction is acceptable, false otherwise.
 */
export function directionOk(triple: SimpleTriple, headUrl: string, bf: number): boolean {
  if (bf === 1) {
    // no directionality
    return true;
  }

  if (triple.object === undefined) {
    // literal objects cannot be used for directionality checks
    return true;
  }

  if (bf > 1) {
    // converging from subject to object
    return headUrl === triple.subject;
  } else {
    // converging from object to subject
    return headUrl === triple.object;
  }
}
