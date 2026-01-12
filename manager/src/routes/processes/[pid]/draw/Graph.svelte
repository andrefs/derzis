<script lang="ts">
	import { onMount } from 'svelte';
	import { Tooltip, Spinner, Button } from '@sveltestrap/sveltestrap';
	import { Sigma } from 'sigma';
	import forceAtlas2 from 'graphology-layout-forceatlas2';
	import FA2Layout from 'graphology-layout-forceatlas2/worker';
	import type { MultiGraph } from 'graphology';

	export let graphData: MultiGraph;
	export let seeds: string[];
	export let state: any;
	export let data: any;

	let renderer: Sigma | undefined;
	let container: HTMLDivElement;
	let isLoading = true;

	function downloadGraph() {
		if (renderer) {
			renderer.renderers[0].snapshot({
				format: 'png',
				backgroundColor: 'white',
				filename: `graph-${data.proc.pid}.png`
			});
		}
	}

	function initializeGraph() {
		if (!container || !graphData) return;

		container.innerHTML = '';
		renderer = new Sigma(graphData, container, {
			minCameraRatio: 0.08,
			maxCameraRatio: 3,
			renderEdgeLabels: true,
			enableEdgeHovering: true,
			edgeReducer(edge: string, data: any) {
				const res: any = { ...data };
				if (state.locked && state.highlightedNodes) {
					if (graphData.extremities(edge).every((n: string) => state.highlightedNodes!.has(n))) {
						res.hidden = false;
						res.size = 3;
						res.color = getPredicateColor(data.fullPredicate || '');
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
						res.size = 3;
						res.color = getPredicateColor(data.fullPredicate || '');
					}
				} else {
					res.color = '#ccc';
					res.size = 1;
				}
				return res;
			},
			nodeReducer(node: string, nodeData: any) {
				const res: any = { ...nodeData };
				if (state.locked && state.highlightedNodes) {
					if (state.highlightedNodes.has(node)) {
						res.zIndex = 2;
						if (state.hoveredNode === node || state.labelHoveredNode === node) {
							res.label = nodeData.displayLabel || '';
						}
						if (state.hoveredNode === node) {
							if (seeds.includes(node)) {
								res.color = '#ff0000';
							} else {
								res.color = '#FFA500';
							}
						} else {
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
					} else {
						res.zIndex = 0;
						res.label = '';
						res.color = '#f6f6f6';
						res.shadowColor = 'transparent';
						res.shadowBlur = 0;
						res.labelBackgroundColor = 'transparent';
						res.labelBorderColor = 'transparent';
					}
				} else if (state.hoveredNeighbors) {
					if (state.hoveredNode === node || state.hoveredNeighbors.has(node)) {
						res.zIndex = 2;
						res.label = nodeData.displayLabel || '';
						if (state.hoveredNode === node) {
							if (seeds.includes(node)) {
								res.color = '#ff0000';
							} else {
								res.color = '#FFA500';
							}
						}
					} else if (seeds.includes(node)) {
						res.zIndex = 1;
						res.label = nodeData.displayLabel || '';
						res.color = '#ffcccc';
					} else {
						res.zIndex = 0;
						res.label = '';
						res.color = '#f6f6f6';
					}
				} else {
					res.zIndex = seeds.includes(node) ? 1 : 0;
				}
				res.hoverable = !state.locked || state.highlightedNodes?.has(node);
				return res;
			}
		});

		// Layout
		const layout = new FA2Layout(renderer.getGraph(), {
			settings: forceAtlas2.inferSettings(renderer.getGraph())
		});
		layout.start();

		// Bind interactions
		renderer.on('enterNode', ({ node }: { node: string }) => {
			if (state.locked) {
				if (state.highlightedNodes!.has(node)) {
					state.labelHoveredNode = node;
					renderer!.refresh({ skipIndexation: true });
				}
			} else {
				setHoveredNode(node);
			}
		});
		renderer.on('leaveNode', () => {
			if (state.locked) {
				state.labelHoveredNode = undefined;
				renderer!.refresh({ skipIndexation: true });
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
			renderer!.refresh({ skipIndexation: true });
		});
		renderer.on('clickStage', () => {
			if (state.locked) {
				state.locked = false;
				state.hoveredNode = undefined;
				state.hoveredNeighbors = undefined;
				state.highlightedNodes = undefined;
				state.addedLevels = undefined;
				state.labelHoveredNode = undefined;
				renderer!.refresh({ skipIndexation: true });
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
						renderer!.refresh({ skipIndexation: true });
					}
				} else if (e.key === 'ArrowLeft') {
					if (state.addedLevels.length > 1) {
						const lastAdded = state.addedLevels.pop();
						for (const n of lastAdded!) {
							state.highlightedNodes.delete(n);
						}
						renderer!.refresh({ skipIndexation: true });
					}
				}
			}
		});
	}

	function setHoveredNode(node?: string) {
		if (!state.locked) {
			if (node) {
				state.hoveredNode = node;
				state.hoveredNeighbors = new Set(graphData.neighbors(node));
			} else {
				state.hoveredNode = undefined;
				state.hoveredNeighbors = undefined;
			}
			renderer!.refresh({ skipIndexation: true });
		}
	}

	function getPredicateColor(predicate: string): string {
		const colors = [
			'#1f77b4',
			'#ff7f0e',
			'#2ca02c',
			'#d62728',
			'#9467bd',
			'#8c564b',
			'#e377c2',
			'#7f7f7f',
			'#bcbd22',
			'#17becf',
			'#aec7e8',
			'#ffbb78',
			'#98d8c8',
			'#f7dc6f',
			'#bb8fce',
			'#85c1e9'
		];
		if (!predicateColors.has(predicate)) {
			const index = predicateColors.size % colors.length;
			predicateColors.set(predicate, colors[index]);
		}
		return predicateColors.get(predicate)!;
	}

	const predicateColors = new Map<string, string>();

	onMount(() => {
		if (graphData && container && !renderer) {
			initializeGraph();
			isLoading = false;
		}
	});
</script>

{#if isLoading}
	<div class="loading-container">
		<Spinner color="primary" />
		<p class="loading-text">Loading graph...</p>
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
		display: flex;
		flex-direction: column;
		height: 100%;
		position: relative;
	}

	.loading-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
	}

	.loading-text {
		margin-top: 10px;
		font-size: 16px;
		color: #666;
	}

	.download-btn {
		position: absolute;
		top: 10px;
		right: 10px;
		z-index: 10;
	}
</style>
