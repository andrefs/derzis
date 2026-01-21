<script lang="ts">
	import { FormGroup, Label, Input, Spinner } from '@sveltestrap/sveltestrap';
	import NodeColorLegend from '$lib/components/ui/NodeColorLegend.svelte';
	import SeedGraphRenderer from '$lib/components/ui/SeedGraphRenderer.svelte';
	import EdgeColorLegend from '$lib/components/ui/EdgeColorLegend.svelte';
	import { getPredicateColor } from '$lib/utils';
	import {
		graphLocked,
		graphAddedLevels,
		isLoading,
		allPredicates,
		selectedPredicates,
		currentHop,
		allTriples,
		filteredTriples,
		nodeHops,
		nodeMaxCreatedAt,
		minDate,
		maxDate,
		minDateLabel,
		maxDateLabel,
		predicateInput,
		isDataLoading,
		nodeCount,
		maxHop,
		seeds,
		branchFactors,
		addPredicate as storeAddPredicate,
		removePredicate as storeRemovePredicate,
		getPredicateDisplayInfo as storeGetPredicateDisplayInfo,
		loadAllTriples as storeLoadAllTriples,
		processTriplesData as storeProcessTriplesData
	} from '$lib/stores/draw-seeds-store';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	export let data;

	onMount(() => {
		// Set initial data from page data
		seeds.set(data.proc.currentStep.seeds);
		branchFactors.set(data.proc.currentStep.branchFactors);

		// Load predicates from URL
		const urlPredicates = $page.url.searchParams.get('predicates');
		if (urlPredicates) {
			selectedPredicates.set(urlPredicates.split(',').filter((p) => p.trim() !== ''));
		}

		// Load and process triples
		storeLoadAllTriples(data.proc.pid).then(() => {
			storeProcessTriplesData();
		});

		// Keyboard navigation
		const handleKeyDown = (event: KeyboardEvent) => {
			selectedPredicates.subscribe(($selected) => {
				if ($selected.length > 0) {
					if (event.key === 'ArrowRight') {
						currentHop.update(c => c + 1);
					} else if (event.key === 'ArrowLeft') {
						currentHop.update(c => c - 1);
					}
				}
			})();
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	});

	$: if (typeof window !== 'undefined') {
		selectedPredicates.subscribe(($selected) => {
			if ($selected.length === 0) {
				goto(window.location.pathname, { replaceState: true });
			} else {
				goto(
					`${window.location.pathname}?predicates=${encodeURIComponent($selected.join(','))}`,
					{ replaceState: true }
				);
			}
		});
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

	$: if (graphData) {
		nodeCount.set(graphData.nodes().length);
	}

	/**
	 * Gets display information for a predicate.
	 * @param predicate - The predicate string.
	 * @returns Object with display and full strings.
	 */
	function getPredicateDisplayInfo(predicate: string): { display: string; full: string } {
		return storeGetPredicateDisplayInfo(predicate);
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
		{#if $isDataLoading}
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
							disabled={$allPredicates.length === 0}
							bind:value={$predicateInput}
							list="predicates-datalist"
							on:keydown={(e) => {
								if (e.key === 'Enter' && $predicateInput.trim()) {
									e.preventDefault();
									storeAddPredicate($predicateInput.trim());
								}
							}}
							on:change={() => {
								if ($predicateInput.trim()) {
									storeAddPredicate($predicateInput.trim());
								}
							}}
						/>
						<datalist id="predicates-datalist">
							{#each $allPredicates as item}
								<option value={item.predicate}>{item.predicate} ({item.count})</option>
							{/each}
						</datalist>
						{#if $selectedPredicates.length > 0}
							<div class="selected-predicates">
								{#each $selectedPredicates as predicate}
									<span
										class="predicate-badge"
										style="background-color: {getPredicateColor(predicate)}"
									>
										{predicate}
										<button
											type="button"
											class="badge-remove"
											on:click={() => storeRemovePredicate(predicate)}>&times;</button
										>
									</span>
								{/each}
							</div>
						{/if}
					</FormGroup>
				</div>
			</div>
			<NodeColorLegend
				locked={$graphLocked}
				addedLevels={$graphAddedLevels}
				maxHop={$maxHop}
			/>
			{#if $selectedPredicates.length > 0}
				<EdgeColorLegend {state} {graphData} selectedPredicates={$selectedPredicates} />
			{/if}
			<div class="row">
				<div class="col h-100">
					{#if $isLoading}
						<div class="loading-container">
							<Spinner color="primary" />
							<p class="loading-text">Loading graph data...</p>
						</div>
					{:else}
						<div class="graph-container">
							<SeedGraphRenderer
								bind:graphData
								triples={$filteredTriples}
								seeds={data.proc.currentStep.seeds}
								nodeHops={$nodeHops}
								bind:locked={$graphLocked}
								bind:addedLevels={$graphAddedLevels}
								bind:state
								enableNodeClick={false}
							/>
							{#if $selectedPredicates.length > 0}
								<div class="hop-counter">
									Hop: {$currentHop}
								</div>
								<div class="node-counter">
									Nodes: {$nodeCount}
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

	.node-counter {
		position: absolute;
		top: 45px;
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
