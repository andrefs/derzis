<script lang="ts">
	import { Col, Row } from '@sveltestrap/sveltestrap';
	import forceAtlas2 from 'graphology-layout-forceatlas2';
	import FA2Layout from 'graphology-layout-forceatlas2/worker';
	export let data;
	import { onMount } from 'svelte';
	import Graph from 'graphology';
	import type { NodeDisplayData, EdgeDisplayData } from 'sigma/types';

	let container: HTMLDivElement;

	onMount(async () => {
		if (typeof window !== 'undefined') {
			const { default: Sigma } = await import('sigma');

			// build dummy graph
			const graph = new Graph({ type: 'directed', multi: true, allowSelfLoops: true });

			for (const t of data.triples) {
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
				// increase size logarithmically based on degree
				graph.updateNodeAttribute(t.subject.valueOf(), 'size', (size) =>
					size ? Math.log(size + 1) * 5 : 1
				);
				graph.updateNodeAttribute(t.object.valueOf(), 'size', (size) =>
					size ? Math.log(size + 1) * 5 : 1
				);
				graph.addDirectedEdge(t.subject.valueOf(), t.object.valueOf(), {
					type: 'arrow',
					displayLabel: t.predicate.valueOf()
				});
			}

			//graph.addNode('John', { x: 0, y: 10, size: 15, label: 'John', color: 'blue' });
			//graph.addNode('Mary', { x: 10, y: 0, size: 10, label: 'Mary', color: 'green' });
			//graph.addNode('Thomas', { x: 7, y: 9, size: 20, label: 'Thomas', color: 'red' });
			//graph.addNode('Hannah', { x: -7, y: -6, size: 25, label: 'Hannah', color: 'teal' });

			//graph.addEdge('John', 'Mary');
			//graph.addEdge('John', 'Thomas');
			//graph.addEdge('John', 'Hannah');
			//graph.addEdge('Hannah', 'Thomas');
			//graph.addEdge('Hannah', 'Mary');

			const sensibleSettings = forceAtlas2.inferSettings(graph);
			const fa2Layout = new FA2Layout(graph, {
				settings: sensibleSettings
			});

			const cancelCurrentAnimation: (() => void) | null = null;
			function startFA2() {
				if (cancelCurrentAnimation) cancelCurrentAnimation();
				fa2Layout.start();
			}

			// Strt FA2
			startFA2();
			setTimeout(() => {
				fa2Layout.stop();
			}, 10 * 1000);

			const renderer = new Sigma(graph, container, {
				minCameraRatio: 0.08,
				maxCameraRatio: 3,
				renderEdgeLabels: true
			});

			/***********************
			 * Hover effect
			 ***********************/
			interface State {
				hoveredNode?: string;

				// State derived from hovered node:
				hoveredNeighbors?: Set<string>;
			}
			const state: State = {};
			function setHoveredNode(node?: string) {
				if (node) {
					state.hoveredNode = node;
					state.hoveredNeighbors = new Set(graph.neighbors(node));
				}

				if (!node) {
					state.hoveredNode = undefined;
					state.hoveredNeighbors = undefined;
				}

				// Refresh rendering
				renderer.refresh({
					// We don't touch the graph data so we can skip its reindexation
					skipIndexation: true
				});
			}
			// Bind graph interactions:
			renderer.on('enterNode', ({ node }) => {
				setHoveredNode(node);
			});
			renderer.on('leaveNode', () => {
				setHoveredNode(undefined);
			});

			// Render nodes accordingly to the internal state:
			// 3. If there is a hovered node, all non-neighbor nodes are greyed
			renderer.setSetting('nodeReducer', (node, data) => {
				const res: Partial<NodeDisplayData> = { ...data };
				if (state.hoveredNeighbors) {
					if (!state.hoveredNeighbors.has(node) && state.hoveredNode !== node) {
						res.color = '#f6f6f6';
					} else {
						res.label = data.displayLabel || '';
					}
				}
				return res;
			});

			renderer.setSetting('edgeReducer', (edge, data) => {
				const res: Partial<EdgeDisplayData> = { ...data };
				if (state.hoveredNode) {
					if (
						!graph
							.extremities(edge)
							.every((n) => n === state.hoveredNode || graph.areNeighbors(n, state.hoveredNode))
					) {
						res.hidden = true;
					} else {
						res.hidden = false;
						res.label = data.displayLabel || '';
					}
				}

				return res;
			});

			return () => {
				renderer.kill();
			};
		}
	});
</script>

<div class="page-container">
	<header class="page-header">
		<h2>Process <span style="font-style: italic;">{data.proc.pid}</span></h2>
	</header>

	<main class="page-main">
		<Row class="h-100">
			<Col class="h-100">
				<div bind:this={container} class="graph-container"></div>
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

	.page-header h2 {
		margin: 0;
		margin-bottom: 0;
		padding: 0;
		line-height: 1.2;
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
</style>
