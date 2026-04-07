import { Triple } from '../Triple';
import { isBlankNode } from '../Triple/Triple';
import type { BlankNodeTripleDocument, TripleDocument } from '../Triple/Triple';
import { createLogger } from '@derzis/common/server';

const log = createLogger('blank-node-utils');

export interface BlankNodeOutgoing {
  blankTriple: BlankNodeTripleDocument;
  outgoing: TripleDocument;
  blankNodeId: string;
}

/**
 * Streams outgoing triples from blank nodes.
 * Shared by TraversalPath and EndpointPath to avoid code duplication.
 *
 * Yields non-blank outgoing triples for each blank node.
 * Handles cursor-based iteration and error logging.
 */
export async function* iterateBlankNodeOutgoings(
  blankNodeTriples: BlankNodeTripleDocument[]
): AsyncIterableIterator<BlankNodeOutgoing> {
  for (const t of blankNodeTriples) {
    const blankNodeId = t.object.id;

    try {
      const cursor = Triple.find({ subject: blankNodeId }).cursor();
      for await (const outgoing of cursor) {
        if (isBlankNode(outgoing)) continue;
        yield { blankTriple: t, outgoing, blankNodeId };
      }
    } catch (error) {
      log.error('Error fetching outgoing triples for blank node', { error, blankNodeId });
      continue; // skip this blank node
    }
  }
}
