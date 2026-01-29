<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Tooltip } from '@sveltestrap/sveltestrap';

	export let data;

	let turtleParts: { parts: { type: string; content: string }[]; inProcess: boolean }[] = [];
	let triples: any[] = [];
	let urlInput = data.url || '';
	$: resourceMap = (data as any).resourceMap || new Map();
	$: urlInput = data.url || '';
	$: currentResourceUrl = data.url;

	// Reactive statement to sort triples when data changes
	$: if (data.triples && data.triples.length > 0) {
		triples = data.triples.sort((a, b) => {
			if (a.inProcess && !b.inProcess) return -1;
			if (!a.inProcess && b.inProcess) return 1;
			return 0;
		});
	} else {
		triples = [];
	}

	function handleSubmit(event: Event) {
		event.preventDefault();
		const formData = new FormData(event.target as HTMLFormElement);
		const newUrl = formData.get('url') as string;
		if (newUrl) {
			goto(`/processes/${data.process.pid}/resource?url=${encodeURIComponent(newUrl)}`);
		}
	}

	function isCurrentResource(url: string): boolean {
		return url === currentResourceUrl;
	}
</script>

<main>
	<h2>Resource Triples for Process {data.process.pid}</h2>

	<form on:submit={handleSubmit} class="resource-form">
		<label for="url">Resource URL:</label>
		<input
			type="text"
			id="url"
			name="url"
			bind:value={urlInput}
			placeholder="Enter resource URL"
			class="resource-input"
		/>
		<button type="submit">Find</button>
	</form>

	{#if triples?.length}
		<div>
			<h3>Triples ({data.triples.length})</h3>
			<p><em>Triples in grey are not found in this process's ProcessTriple collection.</em></p>
			<div class="triples-container">
				{#each triples as t, i}
					{#if t.inProcess}
						<div class="triple in-process">
							{#if resourceMap.has(t.subject)}
								<a
									href="/processes/{data.process.pid}/resource?url={encodeURIComponent(t.subject)}"
									class="resource-link {isCurrentResource(t.subject) ? 'current-resource' : ''}"
								>
									&lt;{t.subject}&gt;
								</a>
							{:else}
								<Tooltip target="subject-{i}" placement="top">
									This resource has not been visited.
								</Tooltip>
								<span id="subject-{i}" class="unvisited-resource {isCurrentResource(t.subject) ? 'current-resource' : ''}">
									&lt;{t.subject}&gt;
								</span>
							{/if}
							{#if resourceMap.has(t.predicate)}
								<a
									href="/processes/{data.process.pid}/resource?url={encodeURIComponent(t.predicate)}"
									class="resource-link {isCurrentResource(t.predicate) ? 'current-resource' : ''}"
								>
									&lt;{t.predicate}&gt;
								</a>
							{:else}
								<Tooltip target="predicate-{i}" placement="top">
									This resource has not been visited.
								</Tooltip>
								<span id="predicate-{i}" class="unvisited-resource {isCurrentResource(t.predicate) ? 'current-resource' : ''}">
									&lt;{t.predicate}&gt;
								</span>
							{/if}
							{#if resourceMap.has(t.object)}
								<a
									href="/processes/{data.process.pid}/resource?url={encodeURIComponent(t.object)}"
									class="resource-link {isCurrentResource(t.object) ? 'current-resource' : ''}"
								>
									&lt;{t.object}&gt;
								</a>
							{:else}
								<Tooltip target="object-{i}" placement="top">
									This resource has not been visited.
								</Tooltip>
								<span id="object-{i}" class="unvisited-resource {isCurrentResource(t.object) ? 'current-resource' : ''}">
									&lt;{t.object}&gt;
								</span>
							{/if}
						</div>
					{:else}
						<Tooltip target="triple-{i}" placement="top">
							This triple does not belong to this process' graph.
						</Tooltip>
						<div id="triple-{i}" class="triple out-of-process">
							{#if resourceMap.has(t.subject)}
								<a
									href="/processes/{data.process.pid}/resource?url={encodeURIComponent(t.subject)}"
									class="resource-link {isCurrentResource(t.subject) ? 'current-resource' : ''}"
								>
									&lt;{t.subject}&gt;
								</a>
							{:else}
								<Tooltip target="grey-subject-{i}" placement="top">
									This resource has not been visited.
								</Tooltip>
								<span id="grey-subject-{i}" class="unvisited-resource {isCurrentResource(t.subject) ? 'current-resource' : ''}">
									&lt;{t.subject}&gt;
								</span>
							{/if}
							{#if resourceMap.has(t.predicate)}
								<a
									href="/processes/{data.process.pid}/resource?url={encodeURIComponent(t.predicate)}"
									class="resource-link {isCurrentResource(t.predicate) ? 'current-resource' : ''}"
								>
									&lt;{t.predicate}&gt;
								</a>
							{:else}
								<Tooltip target="grey-predicate-{i}" placement="top">
									This resource has not been visited.
								</Tooltip>
								<span id="grey-predicate-{i}" class="unvisited-resource {isCurrentResource(t.predicate) ? 'current-resource' : ''}">
									&lt;{t.predicate}&gt;
								</span>
							{/if}
							{#if resourceMap.has(t.object)}
								<a
									href="/processes/{data.process.pid}/resource?url={encodeURIComponent(t.object)}"
									class="resource-link {isCurrentResource(t.object) ? 'current-resource' : ''}"
								>
									&lt;{t.object}&gt;
								</a>
							{:else}
								<Tooltip target="grey-object-{i}" placement="top">
									This resource has not been visited.
								</Tooltip>
								<span id="grey-object-{i}" class="unvisited-resource {isCurrentResource(t.object) ? 'current-resource' : ''}">
									&lt;{t.object}&gt;
								</span>
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		</div>
	{:else if data.url}
		<p>No triples found for this resource URL.</p>
	{:else}
		<p>Enter a resource URL above to view its triples.</p>
	{/if}
</main>

<style>
	.resource-form {
		margin-bottom: 2rem;
	}

	.resource-input {
		width: 70%;
		margin-right: 1rem;
	}

	.triples-container {
		background-color: #f8f9fa;
		padding: 1rem;
		border-radius: 4px;
		overflow-x: auto;
		white-space: nowrap;
		font-family: monospace;
		width: max-content;
		min-width: 100%;
		font-size: 0.9rem;
	}

	.triple {
		margin-bottom: 0.5rem;
	}

	.triple.in-process {
		color: black;
	}

	.triple.out-of-process {
		color: grey;
	}

	.resource-link {
		color: inherit;
		text-decoration: none;
	}

	.unvisited-resource {
		color: grey;
	}

	.current-resource {
		background-color: #fff3cd;
		border-radius: 3px;
		padding: 2px 4px;
	}
</style>
