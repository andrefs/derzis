import { writable, derived, get } from 'svelte/store';
import { formatDateLabel } from '$lib/utils';
import { getTriplesWithinHops } from '$lib/seed-graph-utils';

export type Triple = {
  subject: string;
  predicate: string;
  object: string;
  createdAt: string;
};

// State variables
export const graphLocked = writable(false);
export const graphAddedLevels = writable<Set<string>[]>([]);
export const isLoading = writable(true);
export const allPredicates = writable<Array<{ predicate: string; count: number }>>([]);
export const selectedPredicates = writable<string[]>([]);
export const currentHop = writable(0);
export const allTriples = writable<Triple[]>([]);
export const filteredTriples = writable<Triple[]>([]);
export const nodeHops = writable(new Map<string, number>());
export const nodeMaxCreatedAt = writable(new Map<string, Date>());
export const minDate = writable(new Date());
export const maxDate = writable(new Date());
export const minDateLabel = writable<{ date: string; time: string } | ''>('');
export const maxDateLabel = writable<{ date: string; time: string } | ''>('');
export const predicateInput = writable('');
export const isDataLoading = writable(true);
export const nodeCount = writable(0);
export const maxHop = writable(0);

// Additional stores for data-dependent values
export const seeds = writable<string[]>([]);
export const branchFactors = writable(new Map<string, number>());

// Derived values
export const graphData = writable<any>(null);
export const state = writable({
  hoveredNode: undefined as string | undefined,
  hoveredNeighbors: undefined as Set<string> | undefined,
  locked: false,
  highlightedNodes: undefined as Set<string> | undefined,
  addedLevels: [] as Set<string>[],
  labelHoveredNode: undefined as string | undefined
});

// Functions
export function addPredicate(predicate: string) {
  selectedPredicates.update((current) => {
    if (predicate && !current.includes(predicate)) {
      predicateInput.set('');
      return [...current, predicate];
    }
    return current;
  });
}

export function removePredicate(predicate: string) {
  selectedPredicates.update((current) => current.filter((p) => p !== predicate));
}

export function getPredicateDisplayInfo(predicate: string): { display: string; full: string } {
  if (!predicate) return { display: '', full: '' };
  return { display: predicate, full: predicate };
}

export async function loadAllTriples(pid: string) {
  const currentAllTriples = get(allTriples);
  if (currentAllTriples.length === 0) {
    const response = await fetch(`/api/processes/${pid}/triples.json.gz?includeCreatedAt=true`);
    if (!response.ok) {
      throw new Error(`Failed to fetch triples: ${response.statusText}`);
    }
    const decompStream = new DecompressionStream('gzip');
    const decompressedResponse = response.body!.pipeThrough(decompStream);
    const text = await new Response(decompressedResponse).text();
    const parsed = JSON.parse(text);
    const namedNodeTriples = parsed.filter((t: Triple) => typeof t.object === 'string');
    allTriples.set(namedNodeTriples);
  }
}

export function processTriplesData() {
  const currentAllTriples = get(allTriples);
  const counts = new Map<string, number>();
  for (const t of currentAllTriples) {
    const p = t.predicate;
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  allPredicates.set(
    Array.from(counts.entries())
      .map(([predicate, count]) => ({ predicate, count }))
      .sort((a, b) => b.count - a.count)
  );
  isDataLoading.set(false);
}

// Reactive computations as derived
export const effectiveHop = derived(
  [selectedPredicates, currentHop],
  ([$selectedPredicates, $currentHop]) =>
    $selectedPredicates.length > 0 && $currentHop >= 1 ? $currentHop : 0
);

export const computedFilteredData = derived(
  [allTriples, selectedPredicates, effectiveHop, seeds, branchFactors],
  ([$allTriples, $selectedPredicates, $effectiveHop, $seeds, $branchFactors]) => {
    if ($allTriples.length === 0) return { triples: [], nodeHops: new Map() };
    const sortedTriples = $allTriples.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return getTriplesWithinHops(
      sortedTriples,
      $seeds,
      $selectedPredicates,
      $effectiveHop,
      $branchFactors
    );
  }
);

// Update filteredTriples and nodeHops from computed
computedFilteredData.subscribe(({ triples, nodeHops: hops }) => {
  filteredTriples.set(triples);
  nodeHops.set(hops);
});

// Compute nodeMaxCreatedAt from filteredTriples
export const computedNodeMaxCreatedAt = derived([filteredTriples], ([$filteredTriples]) => {
  const nodeMaxCreatedAt = new Map<string, Date>();
  for (const t of $filteredTriples) {
    const subj = t.subject;
    const date = new Date(t.createdAt);
    if (!nodeMaxCreatedAt.has(subj) || nodeMaxCreatedAt.get(subj)! < date) {
      nodeMaxCreatedAt.set(subj, date);
    }
    const obj = t.object;
    if (!nodeMaxCreatedAt.has(obj) || nodeMaxCreatedAt.get(obj)! < date) {
      nodeMaxCreatedAt.set(obj, date);
    }
  }
  return nodeMaxCreatedAt;
});

computedNodeMaxCreatedAt.subscribe((map) => nodeMaxCreatedAt.set(map));

// Compute dates and labels
export const computedDates = derived([computedNodeMaxCreatedAt], ([$nodeMaxCreatedAt]) => {
  const dates = Array.from($nodeMaxCreatedAt.values());
  if (dates.length === 0) {
    return {
      minDate: new Date(),
      maxDate: new Date(),
      minDateLabel: '' as const,
      maxDateLabel: '' as const
    };
  }
  const min = new Date(Math.min(...dates.map((d) => d.getTime())));
  const max = new Date(Math.max(...dates.map((d) => d.getTime())));
  return {
    minDate: min,
    maxDate: max,
    minDateLabel: formatDateLabel(min),
    maxDateLabel: formatDateLabel(max)
  };
});

computedDates.subscribe(
  ({ minDate: min, maxDate: max, minDateLabel: minL, maxDateLabel: maxL }) => {
    minDate.set(min);
    maxDate.set(max);
    minDateLabel.set(minL);
    maxDateLabel.set(maxL);
  }
);

// Compute maxHop
export const computedMaxHop = derived([nodeHops], ([$nodeHops]) => {
  const hops = Array.from($nodeHops.values());
  return hops.length > 0 ? Math.max(...hops) : 0;
});

computedMaxHop.subscribe((hop) => {
  maxHop.set(hop);
  isLoading.set(false);
});

// Need to adjust for dependencies on data.proc
