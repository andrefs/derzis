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
			const graph = new Graph();

			graph.addNode('John', { x: 0, y: 10, size: 15, label: 'John', color: 'blue' });
			graph.addNode('Mary', { x: 10, y: 0, size: 10, label: 'Mary', color: 'green' });
			graph.addNode('Thomas', { x: 7, y: 9, size: 20, label: 'Thomas', color: 'red' });
			graph.addNode('Hannah', { x: -7, y: -6, size: 25, label: 'Hannah', color: 'teal' });

			graph.addEdge('John', 'Mary');
			graph.addEdge('John', 'Thomas');
			graph.addEdge('John', 'Hannah');
			graph.addEdge('Hannah', 'Thomas');
			graph.addEdge('Hannah', 'Mary');

			const renderer = new Sigma(graph, container, {
				minCameraRatio: 0.1,
				maxCameraRatio: 10
			});
		}
	});
</script>

<header style="padding-bottom: 1rem">
	<h2>Process {data.proc.pid}</h2>
</header>

<main>
	<Row>
		<Col>
			<div bind:this={container} class="container"></div>
		</Col>
	</Row>
</main>

<style>
	.container {
		height: 600px;
		border: 1px solid #ccc;
		border-radius: 4px;
	}
</style>
