<script lang="ts">
	import {
		Accordion,
		AccordionItem,
		Tooltip,
		FormGroup,
		Label,
		Input,
		Spinner,
		Button
	} from '@sveltestrap/sveltestrap';
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
	let numTriples = 0;
	let totalTriples = 100;
	let allTriples: Array<{ subject: string; predicate: string; object: string; createdAt: string }> =
		[];
	let minDateLabel: { date: string; time: string } | '' = '';
	let maxDateLabel: { date: string; time: string } | '' = '';
	let pendingTimeout: ReturnType<typeof setTimeout> | undefined;
	let skipRebuild = false;
	let sliderEnabled = false;

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
	let state: {
		hoveredNode?: string;
		hoveredNeighbors?: Set<string>;
		locked?: boolean;
		highlightedNodes?: Set<string>;
		addedLevels?: Set<string>[];
		labelHoveredNode?: string;
	} = {};

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
		if (allTriples.length === 0) {
			const response = await fetch(
				`/api/processes/${data.proc.pid}/triples.json.gz?includeCreatedAt=true`
			);
			if (!response.ok) {
				throw new Error(`Failed to fetch triples: ${response.statusText}`);
			}
			// uncompress gzipped response
			const decompStream = new DecompressionStream('gzip');
			const decompressedResponse = response.body!.pipeThrough(decompStream);
			const text = await new Response(decompressedResponse).text();
			allTriples = JSON.parse(text);
		}
		// Sort by createdAt descending and take first numTriples (or all if numTriples is 0)
		const sortedTriples = allTriples.sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		);
		const limit = numTriples || allTriples.length;
		return sortedTriples.slice(0, limit);
	}

	let graphData: any = null;

	// Reactive statement to rebuild graph when predicate or numTriples changes
	$: if (
		typeof window !== 'undefined' &&
		selectedPredicate !== undefined &&
		numTriples !== undefined
	) {
		if (skipRebuild) {
			skipRebuild = false;
		} else {
			rebuildGraph();
		}
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

			// Set total and default numTriples
			totalTriples = allTriples.length;
			skipRebuild = true;
			numTriples = totalTriples;
			sliderEnabled = true;

			// Extract unique predicates for dropdown (only once)
			if (allPredicates.length === 0) {
				allPredicates = [...new Set(allTriples.map((t) => t.predicate.valueOf()))].sort();
			}

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

			// build graph
			const graph = new Graph({ type: 'directed', multi: true, allowSelfLoops: true });

			// Collect all unique nodes, sorted with non-seed first, then seed
			const allNodes = new Set<string>();
			for (const t of filteredTriples) {
				allNodes.add(t.subject.valueOf());
				allNodes.add(t.object.valueOf());
			}
			const sortedNodes = Array.from(allNodes).sort((a, b) => {
				const aSeed = data.proc.currentStep.seeds.includes(a);
				const bSeed = data.proc.currentStep.seeds.includes(b);
				if (aSeed && !bSeed) return 1;
				if (!aSeed && bSeed) return -1;
				return a.localeCompare(b);
			});

			// Function to get color based on recency (blue to dark yellow to green)
			function getNodeColor(date: Date): string {
				if (maxDate.getTime() === minDate.getTime()) {
					return '#0000ff'; // Blue for all nodes if all have same age
				}
				const ratio =
					(date.getTime() - minDate.getTime()) / (maxDate.getTime() - minDate.getTime());
				let r, g, b;
				if (ratio < 0.5) {
					// Blue to dark yellow: increase red and green, keep blue
					r = Math.floor(200 * ratio * 2);
					g = Math.floor(200 * ratio * 2);
					b = 255;
				} else {
					// Dark yellow to green: decrease red, keep green, decrease blue
					r = Math.floor(200 * (2 - ratio * 2));
					g = 200;
					b = Math.floor(255 * (2 - ratio * 2));
				}
				return `rgb(${r}, ${g}, ${b})`;
			}

			// Add nodes in sorted order (non-seed first, seed last so rendered on top)
			for (const node of sortedNodes) {
				const isSeed = data.proc.currentStep.seeds.includes(node);
				const date = nodeMaxCreatedAt.get(node) || minDate;
				graph.addNode(node, {
					x: Math.random(),
					y: Math.random(),
					displayLabel: node,
					label: isSeed ? node : ''
				});
			}

			// Add edges
			for (const t of filteredTriples) {
				const predicateInfo = getPredicateDisplayInfo(t.predicate.valueOf());
				graph.addDirectedEdge(t.subject.valueOf(), t.object.valueOf(), {
					type: 'arrow',
					displayLabel: predicateInfo.display,
					fullPredicate: predicateInfo.full
				});
			}

			// Scale sizes based on degree
			for (const node of graph.nodes()) {
				graph.updateNodeAttribute(node, 'size', (size) =>
					size ? Math.max(8, Math.sqrt(size) * 4) : 8
				);
			}

			// Set node colors based on recency
			for (const node of graph.nodes()) {
				const date = nodeMaxCreatedAt.get(node) || minDate;
				const isSeed = data.proc.currentStep.seeds.includes(node);
				graph.setNodeAttribute(node, 'color', isSeed ? '#ff0000' : getNodeColor(date));
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
				enableEdgeEvents: true,
				zIndex: true
			});

			const seeds = data.proc.currentStep.seeds;

			/***********************
			 * Hover effect
			 ***********************/
			// Reset state when loading new graph
			state = {};
			function setHoveredNode(node?: string) {
				if (!state.locked) {
					if (node) {
						state.hoveredNode = node;
						state.hoveredNeighbors = new Set(graphData.neighbors(node));
					} else {
						state.hoveredNode = undefined;
						state.hoveredNeighbors = undefined;
					}

					// Refresh rendering
					renderer.refresh({
						skipIndexation: true
					});
				}
			}
			// Bind graph interactions:
			renderer.on('enterNode', ({ node }: { node: string }) => {
				if (state.locked) {
					state.labelHoveredNode = node;
					renderer.refresh({ skipIndexation: true });
				} else {
					setHoveredNode(node);
				}
			});
			renderer.on('leaveNode', () => {
				if (state.locked) {
					state.labelHoveredNode = undefined;
					renderer.refresh({ skipIndexation: true });
				} else {
					setHoveredNode(undefined);
				}
			});
			renderer.on('clickNode', ({ node }: { node: string }) => {
				if (state.hoveredNode && !state.locked) {
					state.locked = true;
					state.highlightedNodes = new Set([state.hoveredNode, ...state.hoveredNeighbors!]);
					state.addedLevels = [state.highlightedNodes];
				} else if (state.locked) {
					state.locked = false;
					state.hoveredNode = undefined;
					state.hoveredNeighbors = undefined;
					state.highlightedNodes = undefined;
					state.addedLevels = undefined;
					state.labelHoveredNode = undefined;
				}
				// Refresh rendering
				renderer.refresh({
					skipIndexation: true
				});
			});
			renderer.on('clickStage', () => {
				if (state.locked) {
					state.locked = false;
					state.hoveredNode = undefined;
					state.hoveredNeighbors = undefined;
					state.highlightedNodes = undefined;
					state.addedLevels = undefined;
					state.labelHoveredNode = undefined;
					renderer.refresh({
						skipIndexation: true
					});
				}
			});

			document.addEventListener('keydown', (e) => {
				if (state.locked && state.highlightedNodes && state.addedLevels) {
					if (e.key === 'ArrowRight') {
						const currentNodes = new Set(state.highlightedNodes);
						const newNodes = new Set<string>();
						for (const n of currentNodes) {
							for (const neigh of graphData.neighbors(n)) {
								if (!state.highlightedNodes.has(neigh)) {
									newNodes.add(neigh);
								}
							}
						}
						if (newNodes.size > 0) {
							state.highlightedNodes = new Set([...state.highlightedNodes, ...newNodes]);
							state.addedLevels.push(newNodes);
							renderer.refresh({
								skipIndexation: true
							});
						}
					} else if (e.key === 'ArrowLeft') {
						if (state.addedLevels.length > 1) {
							const lastAdded = state.addedLevels.pop();
							for (const n of lastAdded!) {
								state.highlightedNodes.delete(n);
							}
							renderer.refresh({
								skipIndexation: true
							});
						}
					}
				}
			});

			// Render nodes accordingly to the internal state:
			renderer.setSetting('nodeReducer', (node: string, nodeData: NodeDisplayData) => {
				const res: Partial<NodeDisplayData> = { ...nodeData };
				if (state.locked && state.highlightedNodes) {
					if (state.highlightedNodes.has(node)) {
						res.zIndex = 2;
						if (state.hoveredNode === node || state.labelHoveredNode === node) {
							res.label = (nodeData as any).displayLabel || '';
						}
						if (state.hoveredNode === node) {
							res.color = '#FFA500'; // orange for hovered node
						} else {
							// Find level
							let level = 0;
							for (let i = 0; i < state.addedLevels!.length; i++) {
								if (state.addedLevels![i].has(node)) {
									level = i;
									break;
								}
							}
							const numLevels = state.addedLevels!.length;
							let ratio = level / (numLevels + 2);
							let r, g, b;
							if (ratio < 0.5) {
								r = Math.floor(200 * ratio * 2);
								g = Math.floor(200 * ratio * 2);
								b = 255;
							} else {
								r = Math.floor(200 * (2 - ratio * 2));
								g = 200;
								b = Math.floor(255 * (2 - ratio * 2));
							}
							res.color = `rgb(${r}, ${g}, ${b})`;
						}
					} else if (seeds.includes(node)) {
						res.zIndex = 1;
						res.label = (nodeData as any).displayLabel || '';
						res.color = '#ffcccc';
					} else {
						res.zIndex = 0;
						res.label = '';
						res.color = '#f6f6f6';
					}
				} else if (state.hoveredNeighbors) {
					if (state.hoveredNode === node || state.hoveredNeighbors.has(node)) {
						res.zIndex = 2;
						res.label = (nodeData as any).displayLabel || '';
						if (state.hoveredNode === node) {
							res.color = '#FFA500';
						}
					} else if (seeds.includes(node)) {
						res.zIndex = 1;
						res.label = (nodeData as any).displayLabel || '';
						res.color = '#ffcccc';
					} else {
						res.zIndex = 0;
						res.label = '';
						res.color = '#f6f6f6';
					}
				} else {
					res.zIndex = seeds.includes(node) ? 1 : 0;
				}
				return res;
			});

			renderer.setSetting('edgeReducer', (edge: string, data: EdgeDisplayData) => {
				const res: Partial<EdgeDisplayData> = { ...data };
				if (state.locked && state.highlightedNodes) {
					if (graphData.extremities(edge).every((n: string) => state.highlightedNodes!.has(n))) {
						res.hidden = false;
						const predicate = (data as any).fullPredicate || '';
						res.size = 3;
						res.color = getPredicateColor(predicate);
					} else {
						res.hidden = true;
					}
				} else if (state.hoveredNode) {
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
						res.size = 3;
						res.color = getPredicateColor(predicate);
					}
				} else {
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
				Process <a href="/processes/{data.proc.pid}"
					><span style="font-style: italic;">{data.proc.pid}</span></a
				>
			</h2>
		</div>
	</header>

	<main class="page-main">
		<div class="controls-container">
			<Accordion>
				<AccordionItem header="Options">
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
								{#each allPredicates as predicate}
									<option value={predicate}>{predicate}</option>
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
				</AccordionItem>
			</Accordion>
		</div>
		{#if state.locked && state.addedLevels}
			<div class="node-color-legend">
				<h6>Node Distance</h6>
				<div class="legend-row">
					<span class="min-label">closest</span>
					<div class="color-bar"></div>
					<span class="max-label">farthest</span>
				</div>
			</div>
		{:else if minDateLabel && maxDateLabel}
			<div class="node-color-legend">
				<h6>Node Age</h6>
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
			</div>
		{/if}
		<div class="row">
			<div class="col h-100">
				{#if isLoading}
					<div class="loading-container">
						<Spinner color="primary" />
						<p class="loading-text">Loading graph data...</p>
					</div>
				{:else}
					<Tooltip target="graph-container">
						{state.locked
							? 'Press arrow right/left to expand/reduce the highlighted area. Click anywhere to unlock.'
							: 'Click a node to further investigate its neighbors.'}
					</Tooltip>
					<div class="graph-wrapper">
						<div bind:this={container} class="graph-container" id="graph-container"></div>
						{#if renderer}
							<Button color="primary" size="sm" class="download-btn" on:click={downloadGraph}>
								📷 PNG
							</Button>
						{/if}
					</div>
				{/if}

				<!-- Legend for predicate colors (shown when hovering nodes) -->
				{#if (state?.highlightedNodes || state?.hoveredNode) && graphData}
					{@const connectedPredicates = Array.from(
						new Set(
							graphData
								.edges()
								.filter((edge: string) => {
									const extremities = graphData.extremities(edge);
									if (state.locked && state.highlightedNodes) {
										return extremities.every((n: string) => state.highlightedNodes!.has(n));
									} else {
										return (
											extremities.includes(state.hoveredNode!) ||
											graphData.areNeighbors(extremities[0], state.hoveredNode!) ||
											graphData.areNeighbors(extremities[1], state.hoveredNode!)
										);
									}
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
				<!-- Tooltip for full predicate names -->
				<div bind:this={tooltip} class="predicate-tooltip" style="display: none;"></div>
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

	.page-main .controls {
		display: flex;
		justify-content: flex-start;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
		padding: 0.5rem 0;
	}

	.predicate-filter {
		margin: 0;
		min-width: 250px;
		flex: 1;
	}

	.predicate-filter :global(.form-label) {
		margin-bottom: 0.1rem;
		font-weight: 500;
		font-size: 0.85rem;
		line-height: 1.2;
	}

	.predicate-filter :global(.form-select) {
		font-size: 0.85rem;
		padding: 0.2rem 0.4rem;
		margin: 0;
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

	.node-color-legend {
		position: fixed;
		bottom: 20px;
		right: 20px;
		background: rgba(255, 255, 255, 0.95);
		border: 1px solid #ddd;
		border-radius: 8px;
		padding: 8px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		font-size: 12px;
		width: 220px;
		z-index: 1000;
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
		background: linear-gradient(to right, #0000ff, #c8c800, #00c800);
		border-radius: 3px;
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
		height: 100% !important;
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
		position: relative;
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
		left: 20px;
		background: rgba(255, 255, 255, 0.95);
		border: 1px solid #ddd;
		border-radius: 8px;
		padding: 12px;
		max-width: 300px;
		max-height: 80vh;
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
