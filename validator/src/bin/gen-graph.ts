import type { SimpleTriple } from '@derzis/common';
import { getRandom } from '../lib/utils';
import { triplesToTurtle } from '../lib/triples';
import { genPage } from '../lib/gen-html';
import path from 'path';
import { mkdirSync, writeFileSync } from 'fs';

export interface Prefixes {
  [url: string]: string;
}


const genDomain = (n: number, prefixes: Prefixes) => {
  const num = n.toString().padStart(3, '0');
  // three digits with leading zeros
  const pref = `d${num}`;
  prefixes[`http://derzis-val${num}.andrefs.com/sw/`] = pref;
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

const resources = [];

const predicates = Array.from({ length: 20 }, (_, i) => `${domains[i % 4]}:${genResName(i + 1, 'predicate')} `);
const triples: SimpleTriple[] = [];

// level 1: each seed has 20 triples
for (const seed of seeds) {
  for (let rn = 1; rn <= 20; rn++) {
    const predicate = getRandom(predicates, 1)[0];

    const res = Math.random() < 0.9 ? `${domains[rn % 4]}:${genResName(rn, 'resource')} ` : getRandom(seeds, 1)[0];
    if (!res.match(/seed/)) {
      resources.push(res);
    }

    triples.push({
      subject: seed,
      predicate,
      object: res,
    });
  }
}

// level 2: each resource has 10 triples, 50% change of linking to a new resource, 50% chance of linking to an existing resource or seed
const resCount = resources.length;
for (let i = 0; i < resCount; i++) {
  for (let rn = 1; rn <= 10; rn++) {
    const predicate = getRandom(predicates, 1)[0];
    let obj: string;
    if (Math.random() < 0.5) {
      obj = `${domains[rn % 4]}:${genResName(rn + 20, 'resource')} `;
      resources.push(obj);
    } else {
      obj = Math.random() < 0.5 ? getRandom(resources, 1)[0] : getRandom(seeds, 1)[0];
    }
    triples.push({
      subject: resources[i],
      predicate,
      object: obj,
    });
  }
}

const dataFolder = path.join(__dirname, '../../data');
const graphId = `graph-${Date.now()}`;
const graphFolder = path.join(dataFolder, graphId);
// create folder if it doesn't exist
mkdirSync(graphFolder, { recursive: true });

console.log(`Writing graph data to ${path.relative(process.cwd(), graphFolder)}`);
writeFileSync(path.join(graphFolder, 'data.ttl'), triplesToTurtle(prefixes, triples));
writeFileSync(path.join(graphFolder, 'graph.html'), genPage(triples));
