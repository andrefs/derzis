/**
 * Utilities for seed graph rendering and triple filtering.
 */

import { directionOk } from '@derzis/common';

export type Triple = {
  subject: string;
  predicate: string;
  object: string;
  createdAt: string;
};

/**
 * Generates a unique key for a triple.
 * @param triple - The triple object.
 * @returns A string key in the format "subject-predicate-object".
 */
export function getTripleKey(triple: Triple): string {
  return `${triple.subject}-${triple.predicate}-${triple.object}`;
}

/**
 * Performs BFS to find nodes within a certain hop distance from seeds.
 * @param seeds - Array of seed node URIs.
 * @param allTriples - All available triples.
 * @param selectedPredicates - Predicates to consider.
 * @param maxHops - Maximum hop distance.
 * @param predBranchingFactors - Map of predicate to branching factor.
 * @returns A map of node URIs to their hop distances.
 */
export function performBFSForHops(
  seeds: string[],
  allTriples: Triple[],
  selectedPredicates: string[],
  maxHops: number,
  predBranchingFactors: Map<string, number>
): Map<string, number> {
  const visitedNodes = new Set<string>();
  const nodeHops = new Map<string, number>();
  const queue: Array<{ node: string; hops: number }> = [];

  // Start with seed nodes at hop 0
  seeds.forEach((seed) => {
    visitedNodes.add(seed);
    nodeHops.set(seed, 0);
    queue.push({ node: seed, hops: 0 });
  });

  // BFS to find all nodes within maxHops
  while (queue.length > 0) {
    const { node, hops } = queue.shift()!;

    if (hops >= maxHops) continue;

    // Find all triples connected to this node with selected predicates
    for (const triple of allTriples) {
      const predicate = triple.predicate;
      if (!selectedPredicates.includes(predicate)) continue;

      const branchingFactor = predBranchingFactors.get(predicate);
      if (branchingFactor === undefined) continue; // Skip predicates without branching factor

      let connectedNode: string | null = null;

      if (triple.subject === node) {
        connectedNode = triple.object;
      } else if (triple.object === node) {
        connectedNode = triple.subject;
      }

      // Check if the direction is allowed by the branching factor
      let directionAllowed = false;
      if (connectedNode) {
        const simpleTriple = {
          subject: triple.subject,
          predicate: triple.predicate,
          object: triple.object
        };
        directionAllowed = directionOk(simpleTriple, node, branchingFactor);
      }

      if (directionAllowed && connectedNode && !visitedNodes.has(connectedNode)) {
        visitedNodes.add(connectedNode);
        nodeHops.set(connectedNode, hops + 1);
        queue.push({ node: connectedNode, hops: hops + 1 });
      }
    }
  }

  return nodeHops;
}

/**
 * Filters triples to include only those connecting nodes at consecutive hop levels.
 * @param allTriples - All available triples.
 * @param nodeHops - Map of node URIs to hop distances.
 * @returns Array of filtered triples.
 */
export function filterTriplesByConsecutiveHops(
  allTriples: Triple[],
  nodeHops: Map<string, number>
): Triple[] {
  return allTriples.filter((triple) => {
    const subjectHop = nodeHops.get(triple.subject);
    const objectHop = nodeHops.get(triple.object);

    if (subjectHop === undefined || objectHop === undefined) return false;

    // Include triple if hop difference is exactly 1
    return Math.abs(subjectHop - objectHop) === 1;
  });
}

/**
 * Gets triples within specified hops from seeds, considering predicates and branching factors.
 * @param allTriples - All available triples.
 * @param seeds - Array of seed node URIs.
 * @param selectedPredicates - Predicates to consider.
 * @param maxHops - Maximum hop distance.
 * @param predBranchingFactors - Map of predicate to branching factor.
 * @returns Object containing filtered triples and node hop map.
 */
export function getTriplesWithinHops(
  allTriples: Triple[],
  seeds: string[],
  selectedPredicates: string[],
  maxHops: number,
  predBranchingFactors: Map<string, number>
): {
  triples: Triple[];
  nodeHops: Map<string, number>;
} {
  // If no hop expansion requested, return empty list (only seed nodes visible)
  if (maxHops === 0) {
    const nodeHops = new Map<string, number>();
    seeds.forEach((seed) => nodeHops.set(seed, 0));
    return { triples: [], nodeHops };
  }

  const nodeHops = performBFSForHops(
    seeds,
    allTriples,
    selectedPredicates,
    maxHops,
    predBranchingFactors
  );

  // Filter triples to only include those between consecutive hops
  const triples = filterTriplesByConsecutiveHops(allTriples, nodeHops);

  return { triples, nodeHops };
}
