<script lang="ts">
	import { Tooltip, Button } from '@sveltestrap/sveltestrap';
	import forceAtlas2 from 'graphology-layout-forceatlas2';
	import FA2Layout from 'graphology-layout-forceatlas2/worker';
	export let graphData: any = null;
	import { getPredicateColor } from '$lib/utils';
	export let triples: Array<{
		subject: string;
		predicate: string;
		object: string;
		createdAt: string;
	}> = [];
	export let nodeMaxCreatedAt: Map<string, Date>;
	export let minDate: Date;
	export let maxDate: Date;
	export let seeds: string[];
	export let locked: boolean = false;
	export let addedLevels: Set<string>[] | undefined = undefined;
	export let state: {
		hoveredNode?: string;
		hoveredNeighbors?: Set<string>;
		locked?: boolean;
		highlightedNodes?: Set<string>;
		addedLevels?: Set<string>[];
		labelHoveredNode?: string;
	} = {};
	import Graph from 'graphology';
	import type { NodeDisplayData, EdgeDisplayData } from 'sigma/types';
	import { onMount } from 'svelte';

	let container: HTMLDivElement;
	let isLoading = true;
	let renderer: any = null;
	let _dlAsImg: any = null;

	// Helper function to provide full predicate names (no abbreviation)
	function getPredicateDisplayInfo(predicate: string): { display: string; full: string } {
		if (!predicate) return { display: '', full: '' };

		// Display the full predicate name without any abbreviation
		return { display: predicate, full: predicate };
	}

	onMount(() => {
		buildGraph();
	});

	$: triples, buildGraph();

	async function buildGraph() {
		try {
			isLoading = true;
			if (renderer) {
				renderer.kill();
				renderer = null;
			}

			// build graph
			const graph = new Graph({ type: 'directed', multi: true, allowSelfLoops: true });

			// Collect all unique nodes, sorted with non-seed first, then seed
			const allNodes = new Set<string>();
			for (const t of triples) {
				allNodes.add(t.subject.valueOf());
				allNodes.add(t.object.valueOf());
			}
			const sortedNodes = Array.from(allNodes).sort((a, b) => {
				const aSeed = seeds.includes(a);
				const bSeed = seeds.includes(b);
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
				const isSeed = seeds.includes(node);
				const date = nodeMaxCreatedAt.get(node) || minDate;
				graph.addNode(node, {
					x: Math.random(),
					y: Math.random(),
					displayLabel: node,
					label: isSeed ? node : ''
				});
			}

			// Add edges
			for (const t of triples) {
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
				const isSeed = seeds.includes(node);
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

			container.innerHTML = '';
			renderer = new Sigma(graphData, container, {
				minCameraRatio: 0.08,
				maxCameraRatio: 3,
				renderEdgeLabels: true,
				enableEdgeEvents: true,
				zIndex: true
			});

			/***********************
			 * Hover effect
			 ***********************/
			// Reset state when loading new graph
			state = { locked, addedLevels };
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
				console.log('XXXXXXXXXXXXXXXx 1');
				if (state.locked) {
					console.log('XXXXXXXXXXXXXXXx 2');
					if (state.highlightedNodes!.has(node)) {
						console.log('XXXXXXXXXXXXXXXx 3');
						state.labelHoveredNode = node;
						renderer.refresh({ skipIndexation: true });
					} else {
						console.log('XXXXXXXXXXXXXXXx 3.1');
						state.labelHoveredNode = undefined;
					}
					console.log('XXXXXXXXXXXXXXXx 4');
				} else {
					console.log('XXXXXXXXXXXXXXXx 5');
					setHoveredNode(node);
					console.log('XXXXXXXXXXXXXXXx 6');
				}
				console.log('XXXXXXXXXXXXXXXx 7');
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
					locked = true;
					state.highlightedNodes = new Set([state.hoveredNode, ...state.hoveredNeighbors!]);
					state.addedLevels = [state.highlightedNodes];
					addedLevels = state.addedLevels;
				} else if (state.locked) {
					state.locked = false;
					locked = false;
					state.hoveredNode = undefined;
					state.hoveredNeighbors = undefined;
					state.highlightedNodes = undefined;
					state.addedLevels = undefined;
					addedLevels = undefined;
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
					locked = false;
					state.hoveredNode = undefined;
					state.hoveredNeighbors = undefined;
					state.highlightedNodes = undefined;
					state.addedLevels = undefined;
					addedLevels = undefined;
					state.labelHoveredNode = undefined;
					renderer.refresh({
						skipIndexation: true
					});
				}
			});

			document.addEventListener('keydown', (e) => {
				if (!graphData) return;
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
							addedLevels = state.addedLevels;
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
							addedLevels = state.addedLevels;
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
							if (seeds.includes(node)) {
								res.color = '#ff0000'; // bright red for seed
							} else {
								res.color = '#FFA500'; // orange for non-seed
							}
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
							if (seeds.includes(node)) {
								res.color = '#ff0000'; // bright red for seed
							} else {
								res.color = '#FFA500';
							}
						}
					} else if (seeds.includes(node)) {
						res.zIndex = 1;
						res.label = (nodeData as any).displayLabel || '';
						res.color = '#ffcccc';
					} else {
						res.zIndex = 0; // Other nodes at bottom
						res.label = '';
						res.color = '#f6f6f6';
					}
				}
				(res as any).hoverable = !state.locked || state.highlightedNodes?.has(node);
				return res;
			});

			renderer.setSetting('edgeReducer', (edge: string, data: EdgeDisplayData) => {
				const res: Partial<EdgeDisplayData> = { ...data };
				if (!graphData) return res;
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

<Tooltip target="graph-container">
	{state.locked
		? 'Press arrow right/left to expand/reduce the highlighted area. Click anywhere to unlock.'
		: 'Click a node to further investigate its neighbors.'}
</Tooltip>
<div class="graph-wrapper">
	<div bind:this={container} class="graph-container" id="graph-container"></div>
	{#if renderer}
		<Button color="primary" size="sm" class="download-btn" on:click={downloadGraph}>📷 PNG</Button>
	{/if}
</div>

<style>
	.graph-container {
		height: 100%;
		width: 100%;
		border: 1px solid #ccc;
		border-radius: 4px;
		box-sizing: border-box;
		flex: 1;
		position: relative;
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
