import { Prefixes } from '../bin/gen-graph';
import type { SimpleTriple, LiteralObject } from '@derzis/common';

export interface IndexedTriples {
  [subject: string]: SimpleTriple[];
}

/**
 * Escapes a string for use in Turtle/N-Triples format
 */
function escapeTurtleString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Converts a literal object to its Turtle/N-Triples string representation
 */
function literalToString(literal: LiteralObject): string {
  const escaped = escapeTurtleString(literal.value);
  if (literal.language) {
    return `"${escaped}"@${literal.language}`;
  }
  if (literal.datatype) {
    return `"${escaped}"^^<${literal.datatype}>`;
  }
  return `"${escaped}"`;
}

/**
 * Converts an array of RDF triples into Turtle format.
 * Each triple is represented as an object with subject, predicate, and object properties.
 *
 * @param triples - An array of RDF triples.
 * @returns A string in Turtle format representing the RDF triples.
 */
export function triplesToTurtle(
  prefixes: Prefixes,
  triples: SimpleTriple[]
): string {
  const prefixLines = Object.entries(prefixes).map(
    ([url, prefix]) => `@prefix ${prefix}: <${url}> .`
  );
  const lines = triples.map((triple) => {
    if (triple.object !== undefined) {
      return `${triple.subject} ${triple.predicate} ${triple.object} .`;
    } else if (triple.objectLiteral) {
      return `${triple.subject} ${triple.predicate} ${literalToString(triple.objectLiteral)} .`;
    }
    return '';
  }).filter(Boolean);
  return [...prefixLines, '', ...lines].join('\n');
}

function parsePrefix(line: string): { prefix: string; url: string } | null {
  const match = line.match(/^@prefix\s+(.+?):\s+<(.+?)>\s*\.$/);
  if (match) {
    return { prefix: match[1], url: match[2] };
  } else {
    return null;
  }
}

function replacePrefix(value: string, prefixes: { [key: string]: string }): string {
  for (const [prefix, url] of Object.entries(prefixes)) {
    if (value.startsWith(prefix + ':')) {
      return value.replace(prefix + ':', url);
    }
  }
  return value;
}

/**
 * Parses a Turtle formatted string into an indexed structure of RDF triples.
 * The function assumes that the input string contains valid Turtle syntax.
 *
 * @param turtle - A string in Turtle format representing RDF triples.
 * @returns An object where each key is a subject and the value is an array of triples with that subject.
 */
export function parseTriples(turtle: string): IndexedTriples {
  const lines = turtle.split('\n');
  // first parse prefixes
  const prefixes: { [key: string]: string } = lines
    .filter((line) => line.startsWith('@prefix'))
    .map((line) => {
      const match = line.match(/^@prefix\s+(.+?):\s+<(.+?)>\s*\.\s*$/);
      if (match) {
        return { prefix: match[1], url: match[2] };
      } else {
        throw new Error(`Invalid prefix line: ${line}`);
      }
    })
    .reduce(
      (acc, curr) => {
        acc[curr.prefix] = curr.url;
        return acc;
      },
      {} as { [key: string]: string }
    );

  // then parse triples
  const tripleLines = lines.filter((line) => !line.startsWith('@prefix') && line.trim() !== '');
  const triples = tripleLines.map((line) => {
    const match = line.match(/^(.+?)\s+(.+?)\s+(.+?)\s*\.\s*$/);
    if (match) {
      return {
        subject: replacePrefix(match[1], prefixes),
        predicate: replacePrefix(match[2], prefixes),
        object: replacePrefix(match[3], prefixes)
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
