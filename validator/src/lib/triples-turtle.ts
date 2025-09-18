import { Prefixes } from "../bin";

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
