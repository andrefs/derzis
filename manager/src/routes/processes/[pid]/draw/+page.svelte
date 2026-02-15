<script lang="ts">
  import { FormGroup, Label, Input, Spinner } from '@sveltestrap/sveltestrap';
  import NodeColorLegend from '$lib/components/ui/NodeColorLegend.svelte';
  import GraphRenderer from '$lib/components/ui/GraphRenderer.svelte';
  import EdgeColorLegend from '$lib/components/ui/EdgeColorLegend.svelte';
  import { isPredicateSelected, formatDateLabel, getPredicateColor } from '$lib/utils';
  export let data;
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  let graphLocked = false;
  let graphAddedLevels: Set<string>[] = [];

  let isLoading = true;
  let allPredicates: Array<{ predicate: string; count: number }> = [];
  let selectedPredicates: string[] = [];
  let numTriples = 100;
  let totalTriples = 100;
  let allTriples: Array<{ subject: string; predicate: string; object: string; createdAt: string }> =
    [];
  let limitedTriples: Array<{
    subject: string;
    predicate: string;
    object: string;
    createdAt: string;
  }> = [];
  let filteredTriples: Array<{
    subject: string;
    predicate: string;
    object: string;
    createdAt: string;
  }> = [];
  let nodeMaxCreatedAt: Map<string, Date> = new Map();
  let minDate: Date = new Date();
  let maxDate: Date = new Date();
  let minDateLabel: { date: string; time: string } | '' = '';
  let maxDateLabel: { date: string; time: string } | '' = '';
  let skipRebuild = false;
  let sliderEnabled = false;
  let predicateInput = '';
  let isDataLoading = true;

  function addPredicate(predicate: string) {
    if (predicate && !selectedPredicates.includes(predicate)) {
      selectedPredicates = [...selectedPredicates, predicate];
      predicateInput = '';
    }
  }

  function removePredicate(predicate: string) {
    selectedPredicates = selectedPredicates.filter((p) => p !== predicate);
  }

  onMount(async () => {
    const urlPredicates = $page.url.searchParams.get('predicates');
    if (urlPredicates) {
      selectedPredicates = urlPredicates.split(',').filter((p) => p.trim() !== '');
    }
    await loadAllTriples();
    totalTriples = allTriples.length;
    numTriples = totalTriples;
    sliderEnabled = true;
    const counts = new Map<string, number>();
    for (const t of allTriples) {
      const p = t.predicate.valueOf();
      counts.set(p, (counts.get(p) || 0) + 1);
    }
    allPredicates = Array.from(counts.entries())
      .map(([predicate, count]) => ({ predicate, count }))
      .sort((a, b) => b.count - a.count);
    isDataLoading = false;
  });

  $: if (typeof window !== 'undefined') {
    if (selectedPredicates.length === 0) {
      goto(window.location.pathname, { replaceState: true });
    } else {
      goto(
        `${window.location.pathname}?predicates=${encodeURIComponent(selectedPredicates.join(','))}`,
        {
          replaceState: true
        }
      );
    }
  }
  let predicateColors: Map<string, string> = new Map();
  let graphData: any = null;
  let state: {
    hoveredNode?: string;
    hoveredNeighbors?: Set<string>;
    locked?: boolean;
    highlightedNodes?: Set<string>;
    addedLevels?: Set<string>[];
    labelHoveredNode?: string;
  } = {};

  function getPredicateDisplayInfo(predicate: string): { display: string; full: string } {
    if (!predicate) return { display: '', full: '' };

    return { display: predicate, full: predicate };
  }

  async function loadAllTriples() {
    if (allTriples.length === 0) {
      const response = await fetch(
        `/api/processes/${data.proc.pid}/triples.json.gz?includeCreatedAt=true`
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch triples: ${response.statusText}`);
      }
      const decompStream = new DecompressionStream('gzip');
      const decompressedResponse = response.body!.pipeThrough(decompStream);
      const text = await new Response(decompressedResponse).text();
      allTriples = JSON.parse(text);
    }
  }

  $: if (allTriples.length > 0 && numTriples > 0) {
    const sortedTriples = allTriples.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    limitedTriples = sortedTriples.slice(0, numTriples);

    filteredTriples =
      selectedPredicates.length === 0
        ? limitedTriples
        : limitedTriples.filter((t) => selectedPredicates.includes(t.predicate.valueOf()));

    nodeMaxCreatedAt = new Map<string, Date>();
    for (const t of filteredTriples) {
      const subj = t.subject.valueOf();
      const obj = t.object.valueOf();
      const date = new Date(t.createdAt);
      if (!nodeMaxCreatedAt.has(subj) || nodeMaxCreatedAt.get(subj)! < date) {
        nodeMaxCreatedAt.set(subj, date);
      }
      if (!nodeMaxCreatedAt.has(obj) || nodeMaxCreatedAt.get(obj)! < date) {
        nodeMaxCreatedAt.set(obj, date);
      }
    }

    const dates = Array.from(nodeMaxCreatedAt.values());
    if (dates.length > 0) {
      minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
      maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
      minDateLabel = formatDateLabel(minDate);
      maxDateLabel = formatDateLabel(maxDate);
    }
    isLoading = false;
  }
</script>

<div class="page-container">
  <header class="page-header">
    <div class="header-content">
      <h2>
        Process <a href="/processes/{data.proc.pid}"
          ><span style="font-style: italic;">{data.proc.pid}</span></a
        >
      </h2>
    </div>
  </header>

  <main class="page-main">
    {#if isDataLoading}
      <div class="row">
        <div class="col h-100">
          <div class="loading-container">
            <Spinner color="primary" />
            <p class="loading-text">Loading process data...</p>
          </div>
        </div>
      </div>
    {:else}
      <div class="controls-container">
        <div class="options-row">
          <FormGroup class="predicate-filter">
            <Label for="predicate-input">Filter by predicate:</Label>
            <Input
              type="text"
              id="predicate-input"
              placeholder="Select one or more predicates"
              disabled={allPredicates.length === 0}
              bind:value={predicateInput}
              list="predicates-datalist"
              on:keydown={(e) => {
                if (e.key === 'Enter' && predicateInput.trim()) {
                  e.preventDefault();
                  addPredicate(predicateInput.trim());
                }
              }}
              on:change={() => {
                if (predicateInput.trim()) {
                  addPredicate(predicateInput.trim());
                }
              }}
            />
            <datalist id="predicates-datalist">
              {#each allPredicates as item}
                <option value={item.predicate}>{item.predicate} ({item.count})</option>
              {/each}
            </datalist>
            {#if selectedPredicates.length > 0}
              <div class="selected-predicates">
                {#each selectedPredicates as predicate}
                  <span
                    class="predicate-badge"
                    style="background-color: {getPredicateColor(predicate)}"
                  >
                    {predicate}
                    <button
                      type="button"
                      class="badge-remove"
                      on:click={() => removePredicate(predicate)}>&times;</button
                    >
                  </span>
                {/each}
              </div>
            {/if}
          </FormGroup>
          <div class="num-triples-control">
            <label for="num-triples-slider">Number of triples: {numTriples}</label>
            <input
              type="range"
              id="num-triples-slider"
              min="1"
              max={totalTriples}
              bind:value={numTriples}
              disabled={!sliderEnabled}
            />
            <div class="slider-labels">
              <span>1</span>
              <span>{totalTriples}</span>
            </div>
          </div>
        </div>
      </div>
      {#if selectedPredicates.length > 0}
        <NodeColorLegend
          locked={graphLocked}
          addedLevels={graphAddedLevels}
          {minDateLabel}
          {maxDateLabel}
        />
        <EdgeColorLegend {state} {graphData} {selectedPredicates} />
        <div class="row">
          <div class="col h-100">
            {#if isLoading}
              <div class="loading-container">
                <Spinner color="primary" />
                <p class="loading-text">Loading graph data...</p>
              </div>
            {:else}
              <GraphRenderer
                bind:graphData
                triples={filteredTriples}
                seeds={data.proc.currentStep.seeds}
                bind:locked={graphLocked}
                bind:addedLevels={graphAddedLevels}
                bind:state
                {minDate}
                {maxDate}
                {nodeMaxCreatedAt}
              />
            {/if}
          </div>
        </div>
      {:else}
        <div class="row">
          <div class="col h-100">
            <div class="no-selection-container">
              <div class="no-selection-message">
                <h4>Select Predicates to Visualize</h4>
                <p>
                  Use the filter above to choose one or more predicates and start exploring the
                  knowledge graph.
                </p>
              </div>
            </div>
          </div>
        </div>
      {/if}
    {/if}
  </main>
</div>

<style>
  .page-container {
    height: calc(100vh - var(--navbar-height, 56px) - var(--container-padding, 3rem) - 16px);
    max-height: calc(100vh - var(--navbar-height, 56px) - var(--container-padding, 3rem) - 16px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
  }

  .page-header {
    flex-shrink: 0;
    padding-bottom: 1rem;
    margin: 0;
    line-height: 1; /* Reduce line height to minimize space */
  }

  .header-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .page-header h2 {
    margin: 0;
    margin-bottom: 0;
    padding: 0;
    line-height: 1.2;
  }

  .controls-container {
    margin-bottom: 1rem;
  }

  .options-row {
    display: flex;
    gap: 1rem;
    align-items: start;
    flex-wrap: wrap;
  }

  .num-triples-control {
    margin: 0;
    min-width: 150px;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .num-triples-control label {
    font-weight: 500;
    font-size: 0.85rem;
    margin: 0;
    line-height: 1.2;
  }

  .num-triples-control input[type='range'] {
    width: 100%;
    margin: 0;
  }

  .slider-labels {
    display: flex;
    justify-content: space-between;
    width: 100%;
    font-size: 0.75rem;
    color: #666;
    line-height: 1.2;
  }

  .num-triples-control label {
    font-weight: 500;
    font-size: 0.9rem;
  }

  .num-triples-control input[type='range'] {
    width: 100%;
  }

  .slider-labels {
    display: flex;
    justify-content: space-between;
    width: 100%;
    font-size: 0.8rem;
    color: #666;
  }

  .selected-predicates {
    margin-top: 0.5rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .predicate-badge {
    display: inline-flex;
    align-items: center;
    border: 1px solid rgba(0, 0, 0, 0.2);
    border-radius: 0.25rem;
    padding: 0.25rem 0.5rem;
    font-size: 0.875rem;
    color: #fff;
    font-weight: 500;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  .badge-remove {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    margin-left: 0.5rem;
    font-size: 1.2em;
    line-height: 1;
    padding: 0;
    font-weight: bold;
  }

  .badge-remove:hover {
    color: #fff;
  }

  .no-selection-container {
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border: 2px dashed #dee2e6;
    border-radius: 8px;
    background-color: #f8f9fa;
    box-sizing: border-box;
    flex: 1;
  }

  .no-selection-message {
    text-align: center;
    max-width: 400px;
    padding: 2rem;
  }

  .no-selection-message h4 {
    color: #6c757d;
    margin-bottom: 1rem;
    font-weight: 600;
  }

  .no-selection-message p {
    color: #8e9297;
    margin: 0;
    line-height: 1.5;
  }

  .page-main {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* Completely reset Bootstrap spacing */
  .page-main :global(.row) {
    margin: 0 !important;
    flex: 1;
    display: flex !important;
    height: 100% !important;
  }

  .page-main :global(.col) {
    padding: 0 !important;
    margin: 0 !important;
    display: flex !important;
    flex-direction: column !important;
  }

  .loading-container {
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-sizing: border-box;
    flex: 1;
    background-color: #f8f9fa;
  }

  .loading-text {
    margin: 0;
    color: #6c757d;
    font-size: 1.1rem;
  }
</style>
