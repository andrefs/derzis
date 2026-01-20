<script lang="ts">
	import { Tooltip, Button } from '@sveltestrap/sveltestrap';
	import forceAtlas2 from 'graphology-layout-forceatlas2';
	import FA2Layout from 'graphology-layout-forceatlas2/worker';
	import { getPredicateColor } from '$lib/utils';
	import { drawDiscNodeHover } from '$lib/sigma-draw';

	export let graphData: any = null;
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
	export let nodeHops: Map<string, number>;
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

	function getPredicateDisplayInfo(predicate: string): { display: string; full: string } {
		if (!predicate) return { display: '', full: '' };
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
			container.innerHTML = '';

			const graph = new Graph({ type: 'directed', multi: true, allowSelfLoops: true });

			const allNodes = new Set<string>();
			// Always include seed nodes for seed-based exploration
			for (const seed of seeds) {
				allNodes.add(seed);
			}
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

			function getNodeColor(date: Date): string {
				if (maxDate.getTime() === minDate.getTime()) {
					return '#0000ff'; // Blue for all nodes if all have same age
				}
				const ratio =
					(date.getTime() - minDate.getTime()) / (maxDate.getTime() - minDate.getTime());
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
				return `rgb(${r}, ${g}, ${b})`;
			}

			for (const node of sortedNodes) {
				const isSeed = seeds.includes(node);
				graph.addNode(node, {
					x: Math.random(),
					y: Math.random(),
					displayLabel: node,
					label: isSeed ? node : ''
				});
			}

			for (const t of triples) {
				const predicateInfo = getPredicateDisplayInfo(t.predicate.valueOf());
				graph.addDirectedEdge(t.subject.valueOf(), t.object.valueOf(), {
					type: 'arrow',
					displayLabel: predicateInfo.display,
					fullPredicate: predicateInfo.full
				});
			}

			for (const node of graph.nodes()) {
				graph.updateNodeAttribute(node, 'size', (size) =>
					size ? Math.max(8, Math.sqrt(size) * 4) : 8
				);
			}

			for (const node of graph.nodes()) {
				const isSeed = seeds.includes(node);
				if (isSeed) {
					graph.setNodeAttribute(node, 'color', '#ff0000'); // Red for seeds
				} else {
					const date = nodeMaxCreatedAt.get(node) || minDate;
					graph.setNodeAttribute(node, 'color', getNodeColor(date));
				}
			}

			graphData = graph;
			isLoading = false;

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

			const nodeReducer = (node: string, data: NodeDisplayData): NodeDisplayData => {
				const res: NodeDisplayData = { ...data };

				if (state.hoveredNeighbors && !state.hoveredNeighbors.has(node) && state.hoveredNode !== node) {
					res.label = '';
					res.color = '#f6f6f6';
				}

				if (state.highlightedNodes && state.highlightedNodes.has(node)) {
					res.highlighted = true;
				}

				if (addedLevels) {
					for (let i = 0; i < addedLevels.length; i++) {
						if (addedLevels[i].has(node)) {
							res.forceLabel = true;
							break;
						}
					}
				}

				return res;
			};

			const edgeReducer = (edge: string, data: EdgeDisplayData): EdgeDisplayData => {
				const res: EdgeDisplayData = { ...data };

				if (state.hoveredNode && graphData.hasNode(state.hoveredNode)) {
					if (
						!graphData.hasDirectedEdge(state.hoveredNode, graphData.target(edge)) &&
						!graphData.hasDirectedEdge(graphData.source(edge), state.hoveredNode)
					) {
						res.hidden = true;
					}
				}

				return res;
			};

			renderer = new Sigma(graphData, container, {
				renderEdgeLabels: true,
				enableEdgeEvents: true,
				nodeReducer,
				edgeReducer,
				defaultDrawNodeHover: (context, data, settings) => {
					if (!state.locked || state.highlightedNodes?.has(data.key)) {
						drawDiscNodeHover(context, data, settings);
					}
				}
			});

			const camera = renderer.getCamera();

			// Handle node clicks
			renderer.on('clickNode', ({ node }: { node: string }) => {
				if (!locked) {
					const currentState = state.locked;
					state.locked = !currentState;
					locked = !currentState;

					if (!currentState) {
						// Locking: center on the node
						const nodePosition = renderer.graph.getNodeAttribute(node, 'x') || 0;
						const nodePositionY = renderer.graph.getNodeAttribute(node, 'y') || 0;
						const ratio = camera.getState().ratio;
						const angle = camera.getState().angle;
						const x = nodePosition * ratio * Math.cos(-angle) - nodePositionY * ratio * Math.sin(-angle);
						const y = nodePosition * ratio * Math.sin(-angle) + nodePositionY * ratio * Math.cos(-angle);

						renderer.getCamera().setState({
							x: x,
							y: y,
							ratio: ratio,
							angle: angle
						});
					}
				}
			});

			// Handle edge clicks
			renderer.on('clickEdge', ({ edge }: { edge: string }) => {
				const source = graphData.source(edge);
				const target = graphData.target(edge);
				console.log('Edge clicked:', { source, target, edge });
			});

			// Handle node hover
			renderer.on('enterNode', ({ node }: { node: string }) => {
				state.hoveredNode = node;
				const neighbors = new Set<string>();
				graphData.forEachDirectedEdge(node, (edge: string, attributes: any, source: string, target: string) => {
					if (source === node) neighbors.add(target);
					if (target === node) neighbors.add(source);
				});
				state.hoveredNeighbors = neighbors;
			});

			renderer.on('leaveNode', () => {
				state.hoveredNode = undefined;
				state.hoveredNeighbors = undefined;
			});

			// Handle stage clicks (background)
			renderer.on('clickStage', () => {
				state.locked = false;
				locked = false;
			});

			let dragStart: { x: number; y: number } | null = null;

			renderer.on('downNode', ({ event }: { event: any }) => {
				if (event.original?.shiftKey) {
					dragStart = { x: event.x, y: event.y };
				}
			});

			renderer.on('upNode', ({ node, event }: { node: string; event: any }) => {
				if (dragStart && event.original?.shiftKey) {
					const dragEnd = { x: event.x, y: event.y };
					const distance = Math.sqrt(
						Math.pow(dragEnd.x - dragStart.x, 2) + Math.pow(dragEnd.y - dragStart.y, 2)
					);

					if (distance < 10) {
						// This was a click, not a drag
						state.labelHoveredNode = state.labelHoveredNode === node ? undefined : node;
					}
				}
				dragStart = null;
			});

			await fa2Layout.start();
			setTimeout(() => {
				fa2Layout.stop();
			}, 5000);

			renderer.refresh();
		} catch (error) {
			console.error('Error initializing graph:', error);
		}
	}
</script>

<div bind:this={container} class="graph-container"></div>

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
</style>