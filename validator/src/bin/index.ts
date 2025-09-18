import type { SimpleTriple } from '@derzis/common';
import { getRandom } from '../lib/utils';
import { triplesToTurtle } from '../lib/triples-turtle';
import { genPage } from '../lib/gen-html';

export interface Prefixes {
  [url: string]: string;
}


const genDomain = (n: number, prefixes: Prefixes) => {
  const num = n.toString().padStart(3, '0');
  // three digits with leading zeros
  const pref = `d${num}`;
  prefixes[`http://domain-${num}.com/`] = pref;
  return pref;
};
const genResName = (n: number, t: 'resource' | 'seed' | 'predicate') => {
  const num = n.toString().padStart(3, '0');
  return `${t}-${num}`;
};
const prefixes: Prefixes = {};



const domains = [
  genDomain(1, prefixes),
  genDomain(2, prefixes),
  genDomain(3, prefixes),
  genDomain(4, prefixes),
  genDomain(5, prefixes),
];

const seeds = [
  `${domains[0]}:${genResName(1, 'seed')} `,
  `${domains[0]}:${genResName(2, 'seed')} `,
  `${domains[0]}:${genResName(3, 'seed')} `,
  `${domains[1]}:${genResName(4, 'seed')} `,
  `${domains[1]}:${genResName(5, 'seed')} `,
]

const predicates = Array.from({ length: 20 }, (_, i) => `${domains[i % 4]}:${genResName(i + 1, 'predicate')} `);
const triples: SimpleTriple[] = [];

for (const seed of seeds) {
  for (let rn = 1; rn <= 20; rn++) {
    const predicate = getRandom(predicates, 1)[0];
    const object = Math.random() < 0.9 ? `${domains[rn % 4]}:${genResName(rn, 'resource')} ` : getRandom(seeds, 1)[0];

    triples.push({
      subject: seed,
      predicate,
      object
    });
  }
}


console.log(triplesToTurtle(prefixes, triples));
// save genPage output to file
import { writeFileSync } from 'fs';
writeFileSync('output.html', genPage(triples));
