import { SimpleTriple } from '@derzis/common';
import Handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';

const cdnLinks = [
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/sigma.js/2.4.0/sigma.min.js"></script>',
  '<script src="https://cdn.jsdelivr.net/npm/graphology@0.26.0/dist/graphology.umd.min.js"></script>',
  '<script src="https://cdn.jsdelivr.net/npm/graphology-library/dist/graphology-library.min.js"></script>'
]

export function genPage(triples: SimpleTriple[]) {
  // Read template from file ./graph.hbs
  const templateSource = fs.readFileSync(path.join(__dirname, 'graph.hbs'), 'utf-8');
  const template = Handlebars.compile(templateSource);
  return template({ triples, cdnLinks });
}
