import { SimpleTriple } from '@derzis/common';
import * as jsondiffpatch from 'jsondiffpatch';

export function sortTripleArray(triples: SimpleTriple[]) {
  return triples.sort((a, b) => {
    if (a.subject < b.subject) return -1;
    if (a.subject > b.subject) return 1;
    if (a.predicate < b.predicate) return -1;
    if (a.predicate > b.predicate) return 1;
    if (a.object < b.object) return -1;
    if (a.object > b.object) return 1;
    return 0;
  });
}

export function diffTripleArrays(arr1: SimpleTriple[], arr2: SimpleTriple[]) {
  const sorted1 = sortTripleArray(arr1);
  const sorted2 = sortTripleArray(arr2);

  const delta = jsondiffpatch.diff(sorted1, sorted2);
  return delta;
}

export function diffObjs(obj1: any, obj2: any) {
  const delta = jsondiffpatch.diff(obj1, obj2);
  return delta;
}
