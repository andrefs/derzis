<script lang="ts">
	import { Col, Row, Spinner, Button, Input, Label, FormGroup } from '@sveltestrap/sveltestrap';
	import forceAtlas2 from 'graphology-layout-forceatlas2';
	import FA2Layout from 'graphology-layout-forceatlas2/worker';
	export let data;
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import Graph from 'graphology';
	import type { NodeDisplayData, EdgeDisplayData } from 'sigma/types';

	let container: HTMLDivElement;
	let isLoading = true;
	let renderer: any = null;
	let _dlAsImg: any = null;
	let tooltip: HTMLDivElement;
	let allPredicates: string[] = [];
	let selectedPredicate = 'all';
	let numTriples = 100;
	let sliderValue = numTriples;
	let minDateLabel: { date: string; time: string } | '' = '';
	let maxDateLabel: { date: string; time: string } | '' = '';
	let pendingTimeout: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		const urlPredicate = $page.url.searchParams.get('predicate');
		if (urlPredicate && urlPredicate !== selectedPredicate) {
			selectedPredicate = urlPredicate;
		}
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
	let state: { hoveredNode?: string; hoveredNeighbors?: Set<string> } = {};

	// Helper function to provide full predicate names (no abbreviation)
	function getPredicateDisplayInfo(predicate: string): { display: string; full: string } {
		if (!predicate) return { display: '', full: '' };

		// Display the full predicate name without any abbreviation
		return { display: predicate, full: predicate };
	}

	// Generate consistent colors for predicates
	function getPredicateColor(predicate: string): string {
		const colors = [
			'#FF6B6B',
			'#4ECDC4',
			'#45B7D1',
			'#96CEB4',
			'#FFEAA7',
			'#DDA0DD',
			'#98D8C8',
			'#F7DC6F',
			'#BB8FCE',
			'#85C1E9'
		];
		if (!predicateColors.has(predicate)) {
			const index = predicateColors.size % colors.length;
			predicateColors.set(predicate, colors[index]);
		}
		return predicateColors.get(predicate)!;
	}

	async function loadData() {
		const response = await fetch(
			`/api/processes/${data.proc.pid}/triples.json.gz?includeCreatedAt=true`
		);
		if (!response.ok) {
			throw new Error(`Failed to fetch triples: ${response.statusText}`);
		}
		// Decompress gzipped response
		const decompStream = new DecompressionStream('gzip');
		const decompressedResponse = response.body!.pipeThrough(decompStream);
		const text = await new Response(decompressedResponse).text();
		const allTriples = JSON.parse(text) as Array<{
			subject: string;
			predicate: string;
			object: string;
			createdAt: string;
		}>;
		// Sort by createdAt descending and take first numTriples
		const sortedTriples = allTriples.sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		);
		return sortedTriples.slice(0, numTriples);
	}

	let graphData: any = null;

	// Reactive statement to rebuild graph when predicate or numTriples changes
	$: if (
		typeof window !== 'undefined' &&
		selectedPredicate !== undefined &&
		numTriples !== undefined
	) {
		rebuildGraph();
	}

	async function rebuildGraph() {
		// Clean up existing renderer
		if (renderer) {
			renderer.kill();
			renderer = null;
		}
		// Clear container
		if (container) {
			container.innerHTML = '';
		}
		// Cancel any pending timeout
		if (pendingTimeout) {
			clearTimeout(pendingTimeout);
		}
		// Load new graph with delay to prevent rapid changes
		pendingTimeout = setTimeout(async () => {
			await loadGraphData();
			pendingTimeout = undefined;
		}, 300); // Delay to debounce slider changes
	}

	async function loadGraphData() {
		try {
			isLoading = true;
			const triples = await loadData();

			// Extract unique predicates for dropdown
			allPredicates = [...new Set(triples.map((t) => t.predicate.valueOf()))].sort();

			// Filter triples by selected predicate
			const filteredTriples =
				selectedPredicate === 'all'
					? triples
					: triples.filter((t) => t.predicate.valueOf() === selectedPredicate);

			// Compute max createdAt for each node
			const nodeMaxCreatedAt = new Map<string, Date>();
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

			// Find min and max dates
			const dates = Array.from(nodeMaxCreatedAt.values());
			const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
			const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
			const formatDate = (date: Date) => {
				const day = date.getDate().toString().padStart(2, '0');
				const month = (date.getMonth() + 1).toString().padStart(2, '0');
				const year = date.getFullYear();
				const hour = date.getHours().toString().padStart(2, '0');
				const min = date.getMinutes().toString().padStart(2, '0');
				return {
					date: `${day}-${month}-${year}`,
					time: `${hour}:${min}`
				};
			};
			const minFormatted = formatDate(minDate);
			const maxFormatted = formatDate(maxDate);
			minDateLabel = minFormatted;
			maxDateLabel = maxFormatted;

			// Function to get color based on recency (continuous scale)
			function getNodeColor(date: Date): string {
				if (maxDate.getTime() === minDate.getTime()) {
					return '#0000ff'; // Blue for all nodes if all have same age
				}
				const ratio =
					(date.getTime() - minDate.getTime()) / (maxDate.getTime() - minDate.getTime());
				// From blue (old) to red (new)
				const r = Math.floor(255 * ratio);
				const g = 0;
				const b = Math.floor(255 * (1 - ratio));
				return `rgb(${r}, ${g}, ${b})`;
			}

			// build graph
			const graph = new Graph({ type: 'directed', multi: true, allowSelfLoops: true });

			for (const t of filteredTriples) {
				const subjIsSeed = data.proc.currentStep.seeds.includes(t.subject.valueOf());
				const objIsSeed = data.proc.currentStep.seeds.includes(t.object.valueOf());

				graph.mergeNode(t.subject.valueOf(), {
					x: Math.random(),
					y: Math.random(),
					displayLabel: t.subject.valueOf(),
					label: subjIsSeed ? t.subject.valueOf() : ''
				});
				graph.mergeNode(t.object.valueOf(), {
					x: Math.random(),
					y: Math.random(),
					displayLabel: t.object.valueOf(),
					label: objIsSeed ? t.object.valueOf() : ''
				});
				// scale size based on degree with minimum base size
				graph.updateNodeAttribute(t.subject.valueOf(), 'size', (size) =>
					size ? Math.max(8, Math.sqrt(size) * 4) : 8
				);
				graph.updateNodeAttribute(t.object.valueOf(), 'size', (size) =>
					size ? Math.max(8, Math.sqrt(size) * 4) : 8
				);
				const predicateInfo = getPredicateDisplayInfo(t.predicate.valueOf());
				graph.addDirectedEdge(t.subject.valueOf(), t.object.valueOf(), {
					type: 'arrow',
					displayLabel: predicateInfo.display,
					fullPredicate: predicateInfo.full
				});
			}

			// Set node colors based on recency
			for (const node of graph.nodes()) {
				const date = nodeMaxCreatedAt.get(node) || minDate;
				graph.setNodeAttribute(node, 'color', getNodeColor(date));
			}

			graphData = graph;
			isLoading = false;

			// Initialize the graph after DOM update
			setTimeout(initializeGraph, 0);
		} catch (error) {
			console.error('Error loading graph data:', error);
			isLoading = false;
		}
	}

	function downloadGraph() {
		if (renderer) {
			_dlAsImg(renderer, { fileName: 'graph' });
		}
	}

	async function initializeGraph() {
		if (!container || !graphData) return;

		try {
			const { default: Sigma } = await import('sigma');
			const { downloadAsImage } = await import('@sigma/export-image');
			_dlAsImg = downloadAsImage;

			const sensibleSettings = forceAtlas2.inferSettings(graphData);
			const fa2Layout = new FA2Layout(graphData, {
				settings: sensibleSettings
			});

			const cancelCurrentAnimation: (() => void) | null = null;
			function startFA2() {
				if (cancelCurrentAnimation) cancelCurrentAnimation();
				fa2Layout.start();
			}

			// Start FA2
			startFA2();
			setTimeout(() => {
				fa2Layout.stop();
			}, 10 * 1000);

			renderer = new Sigma(graphData, container, {
				minCameraRatio: 0.08,
				maxCameraRatio: 3,
				renderEdgeLabels: true,
				enableEdgeEvents: true
			});

			/***********************
			 * Hover effect
			 ***********************/
			// Reset state when loading new graph
			state = {};
			function setHoveredNode(node?: string) {
				if (node) {
					state.hoveredNode = node;
					state.hoveredNeighbors = new Set(graphData.neighbors(node));
				}

				if (!node) {
					state.hoveredNode = undefined;
					state.hoveredNeighbors = undefined;
				}

				// Refresh rendering
				renderer.refresh({
					skipIndexation: true
				});
			}
			// Bind graph interactions:
			renderer.on('enterNode', ({ node }: { node: string }) => {
				setHoveredNode(node);
			});
			renderer.on('leaveNode', () => {
				setHoveredNode(undefined);
			});
			// Stop FA2 layout when user interacts to prevent artifacts
			renderer.on('downNode', () => {
				fa2Layout.stop();
			});
			renderer.on('downStage', () => {
				fa2Layout.stop();
			});

			// Render nodes accordingly to the internal state:
			renderer.setSetting('nodeReducer', (node: string, data: NodeDisplayData) => {
				const res: Partial<NodeDisplayData> = { ...data };
				if (state.hoveredNeighbors) {
					if (!state.hoveredNeighbors.has(node) && state.hoveredNode !== node) {
						res.label = '';
						res.color = '#f6f6f6';
					} else {
						res.label = (data as any).displayLabel || '';
					}
				}
				return res;
			});

			renderer.setSetting('edgeReducer', (edge: string, data: EdgeDisplayData) => {
				const res: Partial<EdgeDisplayData> = { ...data };
				if (state.hoveredNode) {
					if (
						!graphData
							.extremities(edge)
							.every(
								(n: string) =>
									n === state.hoveredNode || graphData.areNeighbors(n, state.hoveredNode!)
							)
					) {
						res.hidden = true;
					} else {
						res.hidden = false;
						const predicate = (data as any).fullPredicate || '';
						res.size = 3; // Make edges thicker when visible
						res.color = getPredicateColor(predicate);
					}
				} else {
					// Default edge styling when not hovering
					res.color = '#ccc';
					res.size = 1;
				}
				return res;
			});
		} catch (error) {
			console.error('Error initializing graph:', error);
		}
	}
</script>

<div class="page-container">
	<header class="page-header">
		<div class="header-content">
			<h2>
				Newest Triples Chart - Process <a href="/processes/{data.proc.pid}"
					><span style="font-style: italic;">{data.proc.pid}</span></a
				>
			</h2>
			<div class="controls">
				<div class="num-triples-control">
					<label for="num-triples-slider">Number of triples: {sliderValue}</label>
					<input
						type="range"
						id="num-triples-slider"
						min="1"
						max="500"
						bind:value={sliderValue}
						on:change={() => (numTriples = sliderValue)}
					/>
					<div class="slider-labels">
						<span>1</span>
						<span>500</span>
					</div>
				</div>
				{#if minDateLabel && maxDateLabel}
					<div class="node-color-legend">
						<h6>Node Age</h6>
						{#if minDateLabel.date === maxDateLabel.date && minDateLabel.time === maxDateLabel.time}
							<div class="single-date">
								<span class="date">{minDateLabel.date}</span>
								<span class="time">{minDateLabel.time}</span>
							</div>
						{:else}
							<div class="legend-row">
								<span class="min-label">
									<span class="date">{minDateLabel.date}</span>
									<span class="time">{minDateLabel.time}</span>
								</span>
								<div class="color-bar"></div>
								<span class="max-label">
									<span class="date">{maxDateLabel.date}</span>
									<span class="time">{maxDateLabel.time}</span>
								</span>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</header>

	<main class="page-main">
		<Row class="h-100">
			<Col class="h-100">
				{#if isLoading}
					<div class="loading-container">
						<Spinner color="primary" />
						<p class="loading-text">Loading graph data...</p>
					</div>
				{:else}
					<div class="graph-wrapper">
						<div bind:this={container} class="graph-container"></div>
						{#if renderer}
							<Button color="primary" size="sm" class="download-btn" on:click={downloadGraph}>
								📷 PNG
							</Button>
						{/if}
					</div>
				{/if}

				<!-- Legend for predicate colors (shown when hovering nodes) -->
				{#if state?.hoveredNode && graphData}
					{@const connectedPredicates = Array.from(
						new Set(
							graphData
								.edges()
								.filter((edge: string) => {
									const extremities = graphData.extremities(edge);
									return (
										extremities.includes(state.hoveredNode!) ||
										graphData.areNeighbors(extremities[0], state.hoveredNode!) ||
										graphData.areNeighbors(extremities[1], state.hoveredNode!)
									);
								})
								.map(
									(edge: string) =>
										(graphData.getEdgeAttributes(edge) as any).fullPredicate as string
								)
								.filter(
									(predicate: string) =>
										selectedPredicate === 'all' || predicate === selectedPredicate
								)
						)
					)}
					{#if connectedPredicates.length > 0}
						<div class="predicate-legend">
							<h6>Connected Predicates</h6>
							<div class="legend-items">
								{#each connectedPredicates as predicate}
									<div class="legend-item">
										<div
											class="color-box"
											style="background-color: {getPredicateColor(predicate as string)}"
										></div>
										<span class="predicate-text" title={predicate as string}>
											{predicate as string}
										</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				{/if}

				<!-- Tooltip for full predicate names -->
				<div bind:this={tooltip} class="predicate-tooltip" style="display: none;"></div>
			</Col>
		</Row>
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
		align-items: flex-start;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.controls {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		flex: 1;
	}

	.page-header h2 {
		margin: 0;
		margin-bottom: 0;
		padding: 0;
		line-height: 1.2;
	}

	.num-triples-control {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		min-width: 200px;
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

	.num-triples-control label {
		font-weight: 500;
		font-size: 0.9rem;
	}

	.num-triples-control input[type='range'] {
		width: 100%;
	}

	.predicate-filter {
		margin: 0;
		min-width: 300px;
	}

	.predicate-filter :global(.form-label) {
		margin-bottom: 0.25rem;
		font-weight: 500;
		font-size: 0.9rem;
	}

	.predicate-filter :global(.form-select) {
		font-size: 0.9rem;
		padding: 0.25rem 0.5rem;
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
	}

	.page-main :global(.col) {
		padding: 0 !important;
		margin: 0 !important;
		display: flex !important;
		flex-direction: column !important;
	}

	.graph-container {
		height: 100%;
		width: 100%;
		border: 1px solid #ccc;
		border-radius: 4px;
		box-sizing: border-box;
		flex: 1;
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

	.graph-wrapper {
		position: relative;
		height: 100%;
		width: 100%;
		flex: 1;
	}

	.graph-wrapper :global(.download-btn) {
		position: absolute;
		top: 10px;
		right: 10px;
		z-index: 1000;
		opacity: 0.9;
	}

	.graph-wrapper :global(.download-btn):hover {
		opacity: 1;
	}

	.predicate-legend {
		position: fixed;
		top: 20px;
		right: 20px;
		background: rgba(255, 255, 255, 0.95);
		border: 1px solid #ddd;
		border-radius: 8px;
		padding: 12px;
		max-width: 300px;
		max-height: 60vh;
		overflow-y: auto;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		z-index: 1000;
		font-size: 13px;
	}

	.predicate-legend h6 {
		margin: 0 0 8px 0;
		font-size: 14px;
		font-weight: 600;
		color: #333;
	}

	.legend-items {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 20px;
	}

	.color-box {
		width: 12px;
		height: 12px;
		border-radius: 2px;
		flex-shrink: 0;
		border: 1px solid rgba(0, 0, 0, 0.2);
	}

	.predicate-text {
		font-family: monospace;
		font-size: 11px;
		color: #555;
		line-height: 1.2;
		flex: 1;
		min-width: 0;
		word-break: break-all;
		cursor: help;
	}

	.more-text {
		font-style: italic;
		color: #888;
		font-size: 11px;
		padding-left: 20px;
	}

	.node-color-legend {
		background: rgba(255, 255, 255, 0.95);
		border: 1px solid #ddd;
		border-radius: 8px;
		padding: 8px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		font-size: 12px;
		width: 280px;
	}

	.node-color-legend h6 {
		margin: 0 0 4px 0;
		font-size: 13px;
		font-weight: 600;
		color: #333;
		text-align: center;
	}

	.legend-row {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.color-bar {
		flex: 1;
		height: 15px;
		background: linear-gradient(to right, #0000ff, #ff0000);
		border-radius: 3px;
	}

	.single-date {
		text-align: center;
		font-size: 10px;
		color: #555;
		line-height: 1.2;
	}

	.single-date .date {
		font-weight: 500;
		display: block;
	}

	.single-date .time {
		font-size: 9px;
		color: #777;
		display: block;
	}

	.min-label,
	.max-label {
		display: flex;
		flex-direction: column;
		align-items: center;
		font-size: 10px;
		color: #555;
		white-space: nowrap;
		line-height: 1.2;
	}

	.date {
		font-weight: 500;
	}

	.time {
		font-size: 9px;
		color: #777;
	}

	.predicate-tooltip {
		position: fixed;
		background: rgba(0, 0, 0, 0.8);
		color: white;
		padding: 8px 12px;
		border-radius: 4px;
		font-size: 12px;
		font-family: monospace;
		pointer-events: none;
		z-index: 10000;
		max-width: 400px;
		word-break: break-all;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	}
</style>
