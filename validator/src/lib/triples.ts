import { Prefixes } from "../bin/gen-graph";
import { SimpleTriple } from "@derzis/common"

export interface IndexedTriples {
  [subject: string]: SimpleTriple[];
}

/**
 * Converts an array of RDF triples into Turtle format.
 * Each triple is represented as an object with subject, predicate, and object properties.
 *
 * @param triples - An array of RDF triples.
 * @returns A string in Turtle format representing the RDF triples.
 */
export function triplesToTurtle(prefixes: Prefixes, triples: Array<{ subject: string; predicate: string; object: string }>): string {
  const prefixLines = Object.entries(prefixes).map(
    ([url, prefix]) => `@prefix ${prefix}: <${url}> .`
  );
  const lines = triples.map(triple => {
    return `${triple.subject} ${triple.predicate} ${triple.object} .`;
  });
  return [...prefixLines, '', ...lines].join('\n');
}

/**
 * Parses a Turtle formatted string into an indexed structure of RDF triples.
 * The function assumes that the input string contains valid Turtle syntax.
 *
 * @param turtle - A string in Turtle format representing RDF triples.
 * @returns An object where each key is a subject and the value is an array of triples with that subject.
 */
export function parseTriples(turtle: string): IndexedTriples {
  const lines = turtle.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('@prefix'));
  const triples = lines.map(line => {
    const match = line.match(/^(.+?)\s+(.+?)\s+(.+?)\s*\.$/);
    if (match) {
      return {
        subject: match[1],
        predicate: match[2],
        object: match[3],
      };
    } else {
      throw new Error(`Invalid triple line: ${line}`);
    }
  });
  const indexed: IndexedTriples = {};
  for (const triple of triples) {
    if (!indexed[triple.subject]) {
      indexed[triple.subject] = [];
    }
    indexed[triple.subject].push(triple);
  }
  return indexed;
}
