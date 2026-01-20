<script lang="ts">
	import {
		FormGroup,
		Label,
		Input,
		Spinner
	} from '@sveltestrap/sveltestrap';
	import NodeColorLegend from '$lib/components/ui/NodeColorLegend.svelte';
	import GraphRenderer from '$lib/components/ui/GraphRenderer.svelte';
	import EdgeColorLegend from '$lib/components/ui/EdgeColorLegend.svelte';
	import { isPredicateSelected, formatDateLabel } from '$lib/utils';
	export let data;
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	let graphLocked = false;
	let graphAddedLevels: Set<string>[] = [];

	let isLoading = true;
	let allPredicates: Array<{ predicate: string; count: number }> = [];
	let selectedPredicate = 'all';
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

	onMount(async () => {
		const urlPredicate = $page.url.searchParams.get('predicate');
		if (urlPredicate && urlPredicate !== selectedPredicate) {
			selectedPredicate = urlPredicate;
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
	});

	$: if (typeof window !== 'undefined') {
		if (selectedPredicate === 'all') {
			goto(window.location.pathname, { replaceState: true });
		} else {
			goto(`${window.location.pathname}?predicate=${encodeURIComponent(selectedPredicate)}`, {
				replaceState: true
			});
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

	$: if (allTriples.length > 0 && selectedPredicate !== undefined && numTriples > 0) {
		const sortedTriples = allTriples.sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		);
		limitedTriples = sortedTriples.slice(0, numTriples);

		filteredTriples =
			selectedPredicate === 'all'
				? limitedTriples
				: limitedTriples.filter((t) =>
						isPredicateSelected(t.predicate.valueOf(), selectedPredicate)
					);

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
		<div class="controls-container">
			<div class="options-row">
				<FormGroup class="predicate-filter">
					<Label for="predicate-select">Filter by predicate:</Label>
					<Input
						type="select"
						id="predicate-select"
						bind:value={selectedPredicate}
						disabled={allPredicates.length === 0}
					>
						<option value="all">All predicates</option>
						{#each allPredicates as item}
							<option value={item.predicate}>{item.predicate} ({item.count})</option>
						{/each}
					</Input>
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
		<NodeColorLegend
			locked={graphLocked}
			addedLevels={graphAddedLevels}
			{minDateLabel}
			{maxDateLabel}
		/>
		<EdgeColorLegend {state} {graphData} {selectedPredicate} />
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
