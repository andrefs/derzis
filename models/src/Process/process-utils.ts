export const matchesOne = (str: string, patterns: string[]) => {
  let matched = false;
  for (const p of patterns) {
    // pattern is a regex
    if (/^\/(.*)\/$/.test(p)) {
      const re = new RegExp(p);
      if (re.test(str)) {
        matched = true;
        break;
      }
      continue;
    }
    // pattern is a URL prefix
    try {
      const url = new URL(p);
      if (str.startsWith(p)) {
        matched = true;
        break;
      }
    } catch (e) {
      continue;
    }
    // pattern is a string
    if (str.includes(p)) {
      matched = true;
      break;
    }
  }
  return matched;
};

export const matchesAny = (str: string[], patterns: string[]) => {
  return str.some((s) => matchesOne(s, patterns));
};

import { PredLimitation, type PredicateLimitationType } from './aux-classes';

export interface LimsByType {
  'require-past'?: string[];
  'disallow-past'?: string[];
  'require-future'?: string[];
  'disallow-future'?: string[];
}

export const buildLimsByType = (predLimitations: PredLimitation[]): LimsByType => {
  return predLimitations.reduce((acc, pl) => {
    for (const lim of pl.lims as PredicateLimitationType[]) {
      (acc as Record<string, string[]>)[lim] = (acc as Record<string, string[]>)[lim] || [];
      (acc as Record<string, string[]>)[lim].push(pl.predicate);
    }
    return acc;
  }, {} as LimsByType);
};
