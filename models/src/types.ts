/**
 * Common type definitions used across multiple path-related modules.
 */

import type { TypedTripleId } from '@derzis/common';

/**
 * Result returned by genExtendedPaths methods.
 * @template T - The path skeleton type (EndpointPathSkeleton or TraversalPathSkeleton)
 */
export interface ExtendedPathsResult<T> {
  extendedPaths: T[];
  procTriples: TypedTripleId[];
}
