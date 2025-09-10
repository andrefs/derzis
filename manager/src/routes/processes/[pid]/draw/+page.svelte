<script lang="ts">
	export const ssr = false;
	import { Col, Row } from '@sveltestrap/sveltestrap';
	export let data;
	import { onMount } from 'svelte';
	//import Sigma from 'sigma';
	import Graph from 'graphology';

	let container: HTMLDivElement;

	onMount(async () => {
		if (typeof window !== 'undefined') {
			const { default: Sigma } = await import('sigma');

			// build dummy graph
			const graph = new Graph({ type: 'directed', multi: true, allowSelfLoops: true });

			for (const t of data.triples) {
				graph.mergeNode(t.subject.valueOf(), {
					x: Math.random(),
					y: Math.random(),
					label: t.subject.valueOf()
				});
				graph.mergeNode(t.object.valueOf(), {
					x: Math.random(),
					y: Math.random(),
					label: t.object.valueOf()
				});
				graph.addDirectedEdge(t.subject.valueOf(), t.object.valueOf(), {
					type: 'arrow',
					label: t.predicate.valueOf()
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

			const renderer = new Sigma(graph, container, {
				minCameraRatio: 0.1,
				maxCameraRatio: 10
			});
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
