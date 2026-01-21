<script lang="ts">
	import { FormGroup, Label, Input, Spinner } from '@sveltestrap/sveltestrap';
	import NodeColorLegend from '$lib/components/ui/NodeColorLegend.svelte';
	import SeedGraphRenderer from '$lib/components/ui/SeedGraphRenderer.svelte';
	import EdgeColorLegend from '$lib/components/ui/EdgeColorLegend.svelte';
	import { formatDateLabel, getPredicateColor } from '$lib/utils';
	import { directionOk } from '@derzis/common';
	export let data;
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	let graphLocked = false;
	let graphAddedLevels: Set<string>[] = [];

	let isLoading = true;
	let allPredicates: Array<{ predicate: string; count: number }> = [];
	let selectedPredicates: string[] = [];
	let currentHop = 0;
	let allTriples: Array<{ subject: string; predicate: string; object: string; createdAt: string }> =
		[];
	let filteredTriples: Array<{
		subject: string;
		predicate: string;
		object: string;
		createdAt: string;
	}> = [];
	let nodeHops = new Map<string, number>();
	let nodeMaxCreatedAt: Map<string, Date> = new Map();
	let minDate: Date = new Date();
	let maxDate: Date = new Date();
	let minDateLabel: { date: string; time: string } | '' = '';
	let maxDateLabel: { date: string; time: string } | '' = '';
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

	function getTriplesWithinHops(
		allTriples: Array<{ subject: string; predicate: string; object: string; createdAt: string }>,
		seeds: string[],
		selectedPredicates: string[],
		maxHops: number,
		predBranchingFactors: Map<string, number>
	): {
		triples: Array<{ subject: string; predicate: string; object: string; createdAt: string }>;
		nodeHops: Map<string, number>;
	} {
		// If no hop expansion requested, return empty list (only seed nodes visible)
		if (maxHops === 0) {
			const nodeHops = new Map<string, number>();
			seeds.forEach((seed) => nodeHops.set(seed, 0));
			return { triples: [], nodeHops };
		}

		const result = new Set<string>();
		const visitedNodes = new Set<string>();
		const nodeHops = new Map<string, number>();
		const queue: Array<{ node: string; hops: number }> = [];

		// Start with seed nodes at hop 0
		seeds.forEach((seed) => {
			visitedNodes.add(seed);
			nodeHops.set(seed, 0);
			queue.push({ node: seed, hops: 0 });
		});

		// BFS to find all nodes within maxHops
		while (queue.length > 0) {
			const { node, hops } = queue.shift()!;

			if (hops > maxHops) continue;

			// Find all triples connected to this node with selected predicates
			for (const triple of allTriples) {
				const predicate = triple.predicate.valueOf();
				if (!selectedPredicates.includes(predicate)) continue;

				const branchingFactor = predBranchingFactors.get(predicate);
				if (branchingFactor === undefined) continue; // Skip predicates without branching factor

				let connectedNode: string | null = null;
				let tripleKey: string | null = null;

				if (triple.subject.valueOf() === node) {
					connectedNode = triple.object.valueOf();
					tripleKey = `${triple.subject}-${triple.predicate}-${triple.object}`;
				} else if (triple.object.valueOf() === node) {
					connectedNode = triple.subject.valueOf();
					tripleKey = `${triple.subject}-${triple.predicate}-${triple.object}`;
				}

				// Check if the direction is allowed by the branching factor
				let directionAllowed = false;
				if (connectedNode && tripleKey) {
					const simpleTriple = {
						subject: triple.subject.valueOf(),
						predicate: triple.predicate.valueOf(),
						object: triple.object.valueOf()
					};
					directionAllowed = directionOk(simpleTriple, node, branchingFactor);
				}

				if (directionAllowed && !result.has(tripleKey!)) {
					result.add(tripleKey!);

					// Add connected node to queue if not visited and within hop limit
					if (!visitedNodes.has(connectedNode!) && hops < maxHops) {
						visitedNodes.add(connectedNode!);
						nodeHops.set(connectedNode!, hops + 1);
						queue.push({ node: connectedNode!, hops: hops + 1 });
					}
				}
			}
		}

		// Convert triple keys back to actual triples and filter to only include frontier triples
		const triples = allTriples.filter((triple) => {
			const tripleKey = `${triple.subject}-${triple.predicate}-${triple.object}`;
			if (!result.has(tripleKey)) return false;

			// Only include triples that connect consecutive hop levels
			const subjectHop = nodeHops.get(triple.subject.valueOf());
			const objectHop = nodeHops.get(triple.object.valueOf());

			if (subjectHop === undefined || objectHop === undefined) return false;

			// Include triple if hop difference is exactly 1
			return Math.abs(subjectHop - objectHop) === 1;
		});

		return { triples, nodeHops };
	}

	onMount(() => {
		const urlPredicates = $page.url.searchParams.get('predicates');
		if (urlPredicates) {
			selectedPredicates = urlPredicates.split(',').filter((p) => p.trim() !== '');
		}

		// Load data asynchronously
		loadAllTriples().then(() => {
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

		// Add keyboard event listener for hop navigation
		const handleKeyDown = (event: KeyboardEvent) => {
			if (selectedPredicates.length > 0) {
				if (event.key === 'ArrowRight') {
					currentHop += 1;
				} else if (event.key === 'ArrowLeft' && currentHop > 0) {
					currentHop -= 1;
				}
			}
		};

		window.addEventListener('keydown', handleKeyDown);

		// Cleanup function
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
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

	$: if (allTriples.length > 0) {
		const sortedTriples = allTriples.sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		);

		// Get triples within current hop distance from seeds
		// Only show triples when hop count is at least 1
		const effectiveHop = selectedPredicates.length > 0 && currentHop >= 1 ? currentHop : 0;
		const result = getTriplesWithinHops(
			sortedTriples,
			data.proc.currentStep.seeds,
			selectedPredicates,
			effectiveHop,
			data.proc.currentStep.branchFactors
		);
		filteredTriples = result.triples;
		nodeHops = result.nodeHops;

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
				</div>
			</div>
			<NodeColorLegend
				locked={graphLocked}
				addedLevels={graphAddedLevels}
				{minDateLabel}
				{maxDateLabel}
			/>
			{#if selectedPredicates.length > 0}
				<EdgeColorLegend {state} {graphData} {selectedPredicates} />
			{/if}
			<div class="row">
				<div class="col h-100">
					{#if isLoading}
						<div class="loading-container">
							<Spinner color="primary" />
							<p class="loading-text">Loading graph data...</p>
						</div>
					{:else}
						<div class="graph-container">
							<SeedGraphRenderer
								bind:graphData
								triples={filteredTriples}
								seeds={data.proc.currentStep.seeds}
								{nodeHops}
								bind:locked={graphLocked}
								bind:addedLevels={graphAddedLevels}
								bind:state
								{minDate}
								{maxDate}
								{nodeMaxCreatedAt}
							/>
							{#if selectedPredicates.length > 0}
								<div class="hop-counter">
									Hop: {currentHop}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</div>
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

	.graph-container {
		position: relative;
		width: 100%;
		height: 100%;
	}

	.hop-counter {
		position: absolute;
		top: 10px;
		right: 10px;
		background: rgba(255, 255, 255, 0.9);
		border: 1px solid #dee2e6;
		border-radius: 4px;
		padding: 4px 8px;
		font-size: 0.875rem;
		font-weight: 500;
		color: #495057;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
		z-index: 10;
	}
</style>
