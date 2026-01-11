<script lang="ts">
	import { Col, Row, Spinner, Button, Input, Label, FormGroup } from '@sveltestrap/sveltestrap';
	import forceAtlas2 from 'graphology-layout-forceatlas2';
	import FA2Layout from 'graphology-layout-forceatlas2/worker';
	export let data;
	import { onMount } from 'svelte';
	import Graph from 'graphology';
	import type { NodeDisplayData, EdgeDisplayData } from 'sigma/types';

	let container: HTMLDivElement;
	let isLoading = true;
	let renderer: any = null;
	let _dlAsImg: any = null;
	let allPredicates: string[] = [];
	let selectedPredicate = 'all';
	let isInitialLoad = true;

	async function loadData() {
		const response = await fetch(`/api/processes/${data.proc.pid}/triples.json.gz`);
		if (!response.ok) {
			throw new Error(`Failed to fetch triples: ${response.statusText}`);
		}
		// uncompress gzipped response
		const decompStream = new DecompressionStream('gzip');
		const decompressedResponse = response.body!.pipeThrough(decompStream);
		const text = await new Response(decompressedResponse).text();
		const triples = JSON.parse(text);
		return triples as Array<{
			subject: string;
			predicate: string;
			object: string;
		}>;
	}

	let graphData: any = null;

	onMount(() => {
		if (typeof window !== 'undefined') {
			loadGraphData();
		}
	});

	// Reactive statement to rebuild graph when predicate changes
	$: if (typeof window !== 'undefined' && selectedPredicate !== undefined) {
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
		// Load new graph
		await loadGraphData();
	}

	async function loadGraphData() {
		try {
			isLoading = true;
			const triples = await loadData();

			// Extract unique predicates for dropdown
			allPredicates = [...new Set(triples.map((t) => t.predicate.valueOf()))].sort();

			// Set default selected predicate to the first one only on initial load
			if (allPredicates.length > 0 && selectedPredicate === 'all' && isInitialLoad) {
				selectedPredicate = allPredicates[0];
				isInitialLoad = false;
			}

			// Filter triples by selected predicate
			const filteredTriples =
				selectedPredicate === 'all'
					? triples
					: triples.filter((t) => t.predicate.valueOf() === selectedPredicate);

			// build graph
			const graph = new Graph({ type: 'directed', multi: true, allowSelfLoops: true });

			for (const t of filteredTriples) {
				const subjIsSeed = data.proc.currentStep.seeds.includes(t.subject.valueOf());
				const objIsSeed = data.proc.currentStep.seeds.includes(t.object.valueOf());

				graph.mergeNode(t.subject.valueOf(), {
					x: Math.random(),
					y: Math.random(),
					displayLabel: t.subject.valueOf(),
					label: subjIsSeed ? t.subject.valueOf() : '',
					color: subjIsSeed ? 'red' : 'blue'
				});
				graph.mergeNode(t.object.valueOf(), {
					x: Math.random(),
					y: Math.random(),
					displayLabel: t.object.valueOf(),
					label: objIsSeed ? t.object.valueOf() : '',
					color: objIsSeed ? 'red' : 'blue'
				});
				// scale size based on degree with minimum base size
				graph.updateNodeAttribute(t.subject.valueOf(), 'size', (size) =>
					size ? Math.max(8, Math.sqrt(size) * 4) : 8
				);
				graph.updateNodeAttribute(t.object.valueOf(), 'size', (size) =>
					size ? Math.max(8, Math.sqrt(size) * 4) : 8
				);
				graph.addDirectedEdge(t.subject.valueOf(), t.object.valueOf(), {
					type: 'arrow',
					displayLabel: t.predicate.valueOf()
				});
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
				renderEdgeLabels: true
			});

			/***********************
			 * Hover effect
			 ***********************/
			interface State {
				hoveredNode?: string;
				hoveredNeighbors?: Set<string>;
			}
			const state: State = {};
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
						res.label = (data as any).displayLabel || '';
					}
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
				Process <a href="/processes/{data.proc.pid}"
					><span style="font-style: italic;">{data.proc.pid}</span></a
				>
			</h2>
			{#if allPredicates.length > 0}
				<FormGroup class="predicate-filter">
					<Label for="predicate-select">Filter by predicate:</Label>
					<Input type="select" id="predicate-select" bind:value={selectedPredicate}>
						<option value="all">All predicates</option>
						{#each allPredicates as predicate}
							<option value={predicate}>{predicate}</option>
						{/each}
					</Input>
				</FormGroup>
			{/if}
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
</style>
