<script lang="ts">
  import { goto } from '$app/navigation';
  import { Col, Row, Table, Accordion, AccordionItem, Badge } from '@sveltestrap/sveltestrap';
  import { Tooltip } from '@sveltestrap/sveltestrap';
  import { Icon } from 'svelte-icons-pack';
  import { FaSolidArrowDown, FaSolidArrowUp } from 'svelte-icons-pack/fa';

  export let data: {
    process: { pid: string };
    seedUrl?: string;
    headUrl?: string;
    longestPathData?: {
      nodes: string[];
      predicates: string[];
      triples: Array<{
        subject: string;
        predicate: string;
        object: string;
        followDirection: boolean;
        processStep: number;
        sources: string[];
      }>;
    } | null;
    shortestPathData?: {
      nodes: string[];
      predicates: string[];
      triples: Array<{
        subject: string;
        predicate: string;
        object: string;
        followDirection: boolean;
        processStep: number;
        sources: string[];
      }>;
    } | null;
    errorMessage?: string;
    longestPathsCount?: number;
    shortestPathsCount?: number;
  };

  let seedUrl = data.seedUrl || '';
  let headUrl = data.headUrl || '';

  function handleSubmit(event: Event) {
    event.preventDefault();
    const formData = new FormData(event.target as HTMLFormElement);
    seedUrl = formData.get('seedUrl') as string;
    headUrl = formData.get('headUrl') as string;

    if (seedUrl && headUrl) {
      goto(
        `/processes/${data.process.pid}/seed-head?seedUrl=${encodeURIComponent(seedUrl)}&headUrl=${encodeURIComponent(headUrl)}`
      );
    }
  }

  function isCurrentResource(url: string): boolean {
    return url === data.seedUrl || url === data.headUrl;
  }

  function getTripleDirection(
    triple: { subject: string; object: string },
    previousTriple: { subject: string; object: string } | null,
    seedUrl: string
  ): 'down' | 'up' {
    if (previousTriple === null) {
      return triple.subject === seedUrl ? 'down' : 'up';
    }

    const prevSubject = previousTriple.subject;
    const prevObject = previousTriple.object;
    const currSubject = triple.subject;
    const currObject = triple.object;

    const subjectMatchesPrev = currSubject === prevSubject || currSubject === prevObject;
    const objectMatchesPrev = currObject === prevSubject || currObject === prevObject;

    if (subjectMatchesPrev) {
      return 'down';
    } else if (objectMatchesPrev) {
      return 'up';
    } else {
      return triple.subject === seedUrl ? 'down' : 'up';
    }
  }
</script>

<main>
  <h2>Find Longest Path for Process {data.process.pid}</h2>

  <form on:submit={handleSubmit} class="seed-head-form">
    <div class="form-group">
      <label for="seedUrl">Seed Resource URL:</label>
      <input
        type="text"
        id="seedUrl"
        name="seedUrl"
        bind:value={seedUrl}
        placeholder="Enter seed resource URL"
        class="form-control"
      />
    </div>

    <div class="form-group">
      <label for="headUrl">Head Resource URL:</label>
      <input
        type="text"
        id="headUrl"
        name="headUrl"
        bind:value={headUrl}
        placeholder="Enter head resource URL"
        class="form-control"
      />
    </div>

    <button type="submit" class="btn btn-primary">Find path examples</button>
  </form>

  {#if data.errorMessage}
    <div class="alert alert-danger mt-3">
      {data.errorMessage}
    </div>
  {/if}

  {#if data.longestPathData || data.shortestPathData}
    <div class="mt-4">
      <Accordion>
        {#if data.longestPathData}
          <AccordionItem header="Longest path example ({data.longestPathsCount || 1} found)">
            <p><strong>Path Length:</strong> {data.longestPathData.nodes.length} nodes</p>
            <p><strong>Predicates:</strong> {data.longestPathData.predicates.length} predicates</p>

            <h4 class="mt-3">Node URLs:</h4>
            <ul class="node-list">
              {#each data.longestPathData.nodes as node, i}
                <li>
                  <span class="node-number">{i + 1}. </span>
                  <a href={node} target="_blank" rel="noopener noreferrer">{node}</a>
                  {#if i === 0}
                    <span class="node-label seed-label"> (Seed)</span>{/if}
                  {#if i === data.longestPathData.nodes.length - 1}
                    <span class="node-label head-label"> (Head)</span>{/if}
                </li>
              {/each}
            </ul>

            <h4 class="mt-3">Triples in Path:</h4>
            <div class="triples-container">
              {#each data.longestPathData.triples as triple, i}
                <div class="triple in-process step-{triple.processStep}" id="longest-triple-{i}">
                  <span class="triple-number">{i + 1}.</span>
                  <span class="triple-content">
                    <a
                      href="/processes/{data.process.pid}/resource?url={encodeURIComponent(
                        triple.subject
                      )}"
                      class="resource-link {isCurrentResource(triple.subject)
                        ? 'current-resource'
                        : ''}"
                    >
                      &lt;{triple.subject}&gt;
                    </a>
                    <a
                      href="/processes/{data.process.pid}/resource?url={encodeURIComponent(
                        triple.predicate
                      )}"
                      class="resource-link {isCurrentResource(triple.predicate)
                        ? 'current-resource'
                        : ''}"
                    >
                      &lt;{triple.predicate}&gt;
                    </a>
                    <a
                      href="/processes/{data.process.pid}/resource?url={encodeURIComponent(
                        triple.object
                      )}"
                      class="resource-link {isCurrentResource(triple.object)
                        ? 'current-resource'
                        : ''}"
                    >
                      &lt;{triple.object}&gt;
                    </a>
                  </span>
                  <span class="triple-direction-icon">
                    {#if triple.followDirection}
                      <Badge color="success">FD</Badge>
                    {/if}
                    <Badge color="secondary" class={triple.followDirection ? 'ms-1' : ''}
                      >{triple.processStep}</Badge
                    >
                    {#if getTripleDirection(triple, i > 0 && data.longestPathData?.triples[i - 1] ? data.longestPathData.triples[i - 1] : null, data.seedUrl || '') === 'down'}
                      <Icon src={FaSolidArrowDown} className="arrow-down ms-1" />
                    {:else}
                      <Icon src={FaSolidArrowUp} className="arrow-up ms-1" />
                    {/if}
                  </span>
                </div>
                <Tooltip target="longest-triple-{i}" placement="top">
                  <div class="sources-tooltip">
                    <strong>Sources:</strong>
                    {#if triple.sources.length > 0}
                      {#each triple.sources as source}
                        <div class="source-url">{source}</div>
                      {/each}
                    {:else}
                      <div class="source-url">None</div>
                    {/if}
                  </div>
                </Tooltip>
              {/each}
            </div>
          </AccordionItem>
        {/if}

        {#if data.shortestPathData}
          <AccordionItem header="Shortest path example ({data.shortestPathsCount || 1} found)">
            <p><strong>Path Length:</strong> {data.shortestPathData.nodes.length} nodes</p>
            <p><strong>Predicates:</strong> {data.shortestPathData.predicates.length} predicates</p>

            <h4 class="mt-3">Node URLs:</h4>
            <ul class="node-list">
              {#each data.shortestPathData.nodes as node, i}
                <li>
                  <span class="node-number">{i + 1}. </span>
                  <a href={node} target="_blank" rel="noopener noreferrer">{node}</a>
                  {#if i === 0}
                    <span class="node-label seed-label"> (Seed)</span>{/if}
                  {#if i === data.shortestPathData.nodes.length - 1}
                    <span class="node-label head-label"> (Head)</span>{/if}
                </li>
              {/each}
            </ul>

            <h4 class="mt-3">Triples in Path:</h4>
            <div class="triples-container">
              {#each data.shortestPathData.triples as triple, i}
                <div class="triple in-process step-{triple.processStep}" id="shortest-triple-{i}">
                  <span class="triple-number">{i + 1}.</span>
                  <span class="triple-content">
                    <a
                      href="/processes/{data.process.pid}/resource?url={encodeURIComponent(
                        triple.subject
                      )}"
                      class="resource-link {isCurrentResource(triple.subject)
                        ? 'current-resource'
                        : ''}"
                    >
                      &lt;{triple.subject}&gt;
                    </a>
                    <a
                      href="/processes/{data.process.pid}/resource?url={encodeURIComponent(
                        triple.predicate
                      )}"
                      class="resource-link {isCurrentResource(triple.predicate)
                        ? 'current-resource'
                        : ''}"
                    >
                      &lt;{triple.predicate}&gt;
                    </a>
                    <a
                      href="/processes/{data.process.pid}/resource?url={encodeURIComponent(
                        triple.object
                      )}"
                      class="resource-link {isCurrentResource(triple.object)
                        ? 'current-resource'
                        : ''}"
                    >
                      &lt;{triple.object}&gt;
                    </a>
                  </span>
                  <span class="triple-direction-icon">
                    {#if triple.followDirection}
                      <Badge color="success">FD</Badge>
                    {/if}
                    <Badge color="secondary" class={triple.followDirection ? 'ms-1' : ''}
                      >{triple.processStep}</Badge
                    >
                    {#if getTripleDirection(triple, i > 0 && data.shortestPathData?.triples[i - 1] ? data.shortestPathData.triples[i - 1] : null, data.seedUrl || '') === 'down'}
                      <Icon src={FaSolidArrowDown} className="arrow-down ms-1" />
                    {:else}
                      <Icon src={FaSolidArrowUp} className="arrow-up ms-1" />
                    {/if}
                  </span>
                </div>
                <Tooltip target="shortest-triple-{i}" placement="top">
                  <div class="sources-tooltip">
                    <strong>Sources:</strong>
                    {#if triple.sources.length > 0}
                      {#each triple.sources as source}
                        <div class="source-url">{source}</div>
                      {/each}
                    {:else}
                      <div class="source-url">None</div>
                    {/if}
                  </div>
                </Tooltip>
              {/each}
            </div>
          </AccordionItem>
        {/if}
      </Accordion>
    </div>
  {/if}
</main>

<style>
  .seed-head-form {
    max-width: 800px;
    margin-bottom: 2rem;
  }

  .form-group {
    margin-bottom: 1rem;
  }

  .form-control {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
  }

  .node-list {
    list-style-type: none;
    padding-left: 0;
    background-color: #f8f9fa;
    padding: 1rem;
    border-radius: 4px;
  }

  .node-list li {
    margin-bottom: 0.5rem;
    padding: 0.5rem;
    background-color: white;
    border-radius: 4px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .node-number {
    font-weight: bold;
    color: #6c757d;
    min-width: 2rem;
  }

  .node-label {
    font-size: 0.8rem;
    font-style: italic;
    padding: 0.2rem 0.4rem;
    border-radius: 3px;
    margin-left: auto;
  }

  .seed-label {
    background-color: #d4edda;
    color: #155724;
  }

  .head-label {
    background-color: #cce5ff;
    color: #004085;
  }

  .triples-container {
    background-color: #f8f9fa;
    padding: 1rem;
    border-radius: 4px;
    font-family: monospace;
    font-size: 0.9rem;
  }

  .triple {
    margin-bottom: 0.5rem;
    padding: 0.5rem;
    background-color: white;
    border-radius: 4px;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  .step-1 {
    background-color: #d4edda;
    border-left: 3px solid #28a745;
  }

  .step-2 {
    background-color: #cce5ff;
    border-left: 3px solid #004085;
  }

  .step-3 {
    background-color: #fff3cd;
    border-left: 3px solid #856404;
  }

  .step-4 {
    background-color: #f8d7da;
    border-left: 3px solid #721c24;
  }

  .step-5 {
    background-color: #e2e3e5;
    border-left: 3px solid #383d41;
  }

  .triple-number {
    font-weight: bold;
    margin-right: 0.5rem;
    color: #6c757d;
    min-width: 2rem;
  }

  .triple-direction-icon {
    margin-right: 0.5rem;
    min-width: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .triple-direction-icon :global(svg) {
    width: 1em;
    height: 1em;
    color: #6c757d;
  }

  .triple-direction-icon :global(.badge) {
    font-size: 0.7rem;
    padding: 0.3em 0.5em;
  }

  :global(.tooltip) {
    max-width: none !important;
  }

  :global(.tooltip-inner) {
    max-width: none;
  }

  .sources-tooltip {
    text-align: left;
  }

  .source-url {
    word-break: break-all;
    font-size: 0.85em;
  }

  :global(.arrow-down) {
    color: #28a745;
  }

  :global(.arrow-up) {
    color: #dc3545;
  }

  .triple-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  .alert {
    padding: 1rem;
    border-radius: 4px;
  }

  .alert-danger {
    background-color: #f8d7da;
    color: #721c24;
    border: 1px solid #f5c6cb;
  }
</style>
