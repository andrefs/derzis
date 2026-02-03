<script lang="ts">
	import { goto } from '$app/navigation';
	import { Col, Row, Table, Accordion, AccordionItem } from '@sveltestrap/sveltestrap';
	import { Tooltip } from '@sveltestrap/sveltestrap';

	export let data: {
		process: { pid: string };
		seedUrl?: string;
		headUrl?: string;
		longestPathData?: {
			nodes: string[];
			predicates: string[];
			triples: Array<{
				subject: string;
				predicate: string;
				object: string;
			}>;
		} | null;
		shortestPathData?: {
			nodes: string[];
			predicates: string[];
			triples: Array<{
				subject: string;
				predicate: string;
				object: string;
			}>;
		} | null;
		errorMessage?: string;
	};

	let seedUrl = data.seedUrl || '';
	let headUrl = data.headUrl || '';

	function handleSubmit(event: Event) {
		event.preventDefault();
		const formData = new FormData(event.target as HTMLFormElement);
		seedUrl = formData.get('seedUrl') as string;
		headUrl = formData.get('headUrl') as string;

		if (seedUrl && headUrl) {
			goto(
				`/processes/${data.process.pid}/seed-head?seedUrl=${encodeURIComponent(seedUrl)}&headUrl=${encodeURIComponent(headUrl)}`
			);
		}
	}

	function isCurrentResource(url: string): boolean {
		return url === data.seedUrl || url === data.headUrl;
	}
</script>

<main>
	<h2>Find Longest Path for Process {data.process.pid}</h2>

	<form on:submit={handleSubmit} class="seed-head-form">
		<div class="form-group">
			<label for="seedUrl">Seed Resource URL:</label>
			<input
				type="text"
				id="seedUrl"
				name="seedUrl"
				bind:value={seedUrl}
				placeholder="Enter seed resource URL"
				class="form-control"
			/>
		</div>

		<div class="form-group">
			<label for="headUrl">Head Resource URL:</label>
			<input
				type="text"
				id="headUrl"
				name="headUrl"
				bind:value={headUrl}
				placeholder="Enter head resource URL"
				class="form-control"
			/>
		</div>

		<button type="submit" class="btn btn-primary">Find example of long path</button>
	</form>

	{#if data.errorMessage}
		<div class="alert alert-danger mt-3">
			{data.errorMessage}
		</div>
	{/if}

	{#if data.longestPathData || data.shortestPathData}
		<div class="mt-4">
			<Accordion>
				{#if data.longestPathData}
					<AccordionItem header="Longest Path Found">
						<p><strong>Path Length:</strong> {data.longestPathData.nodes.length} nodes</p>
						<p><strong>Predicates:</strong> {data.longestPathData.predicates.length} predicates</p>

						<h4 class="mt-3">Node URLs:</h4>
						<ul class="node-list">
							{#each data.longestPathData.nodes as node, i}
								<li>
									<span class="node-number">{i + 1}. </span>
									<a href={node} target="_blank" rel="noopener noreferrer">{node}</a>
									{#if i === 0}
										<span class="node-label seed-label"> (Seed)</span>{/if}
									{#if i === data.longestPathData.nodes.length - 1}
										<span class="node-label head-label"> (Head)</span>{/if}
								</li>
							{/each}
						</ul>

						<h4 class="mt-3">Triples in Path:</h4>
						<div class="triples-container">
							{#each data.longestPathData.triples as triple, i}
								<div class="triple in-process">
									<span class="triple-number">{i + 1}.</span>
									<span class="triple-content">
										<a
											href="/processes/{data.process.pid}/resource?url={encodeURIComponent(triple.subject)}"
											class="resource-link {isCurrentResource(triple.subject) ? 'current-resource' : ''}"
										>
											&lt;{triple.subject}&gt;
										</a>
										<a
											href="/processes/{data.process.pid}/resource?url={encodeURIComponent(triple.predicate)}"
											class="resource-link {isCurrentResource(triple.predicate) ? 'current-resource' : ''}"
										>
											&lt;{triple.predicate}&gt;
										</a>
										<a
											href="/processes/{data.process.pid}/resource?url={encodeURIComponent(triple.object)}"
											class="resource-link {isCurrentResource(triple.object) ? 'current-resource' : ''}"
										>
											&lt;{triple.object}&gt;
										</a>
									</span>
								</div>
							{/each}
						</div>
					</AccordionItem>
				{/if}

				{#if data.shortestPathData}
					<AccordionItem header="Shortest Path Found">
						<p><strong>Path Length:</strong> {data.shortestPathData.nodes.length} nodes</p>
						<p><strong>Predicates:</strong> {data.shortestPathData.predicates.length} predicates</p>

						<h4 class="mt-3">Node URLs:</h4>
						<ul class="node-list">
							{#each data.shortestPathData.nodes as node, i}
								<li>
									<span class="node-number">{i + 1}. </span>
									<a href={node} target="_blank" rel="noopener noreferrer">{node}</a>
									{#if i === 0}
										<span class="node-label seed-label"> (Seed)</span>{/if}
									{#if i === data.shortestPathData.nodes.length - 1}
										<span class="node-label head-label"> (Head)</span>{/if}
								</li>
							{/each}
						</ul>

						<h4 class="mt-3">Triples in Path:</h4>
						<div class="triples-container">
							{#each data.shortestPathData.triples as triple, i}
								<div class="triple in-process">
									<span class="triple-number">{i + 1}.</span>
									<span class="triple-content">
										<a
											href="/processes/{data.process.pid}/resource?url={encodeURIComponent(triple.subject)}"
											class="resource-link {isCurrentResource(triple.subject) ? 'current-resource' : ''}"
										>
											&lt;{triple.subject}&gt;
										</a>
										<a
											href="/processes/{data.process.pid}/resource?url={encodeURIComponent(triple.predicate)}"
											class="resource-link {isCurrentResource(triple.predicate) ? 'current-resource' : ''}"
										>
											&lt;{triple.predicate}&gt;
										</a>
										<a
											href="/processes/{data.process.pid}/resource?url={encodeURIComponent(triple.object)}"
											class="resource-link {isCurrentResource(triple.object) ? 'current-resource' : ''}"
										>
											&lt;{triple.object}&gt;
										</a>
									</span>
								</div>
							{/each}
						</div>
					</AccordionItem>
				{/if}
			</Accordion>
		</div>
	{/if}
</main>

<style>
	.seed-head-form {
		max-width: 800px;
		margin-bottom: 2rem;
	}

	.form-group {
		margin-bottom: 1rem;
	}

	.form-control {
		width: 100%;
		padding: 0.5rem;
		border: 1px solid #ccc;
		border-radius: 4px;
	}

	.node-list {
		list-style-type: none;
		padding-left: 0;
		background-color: #f8f9fa;
		padding: 1rem;
		border-radius: 4px;
	}

	.node-list li {
		margin-bottom: 0.5rem;
		padding: 0.5rem;
		background-color: white;
		border-radius: 4px;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.node-number {
		font-weight: bold;
		color: #6c757d;
		min-width: 2rem;
	}

	.node-label {
		font-size: 0.8rem;
		font-style: italic;
		padding: 0.2rem 0.4rem;
		border-radius: 3px;
		margin-left: auto;
	}

	.seed-label {
		background-color: #d4edda;
		color: #155724;
	}

	.head-label {
		background-color: #cce5ff;
		color: #004085;
	}

	.triples-container {
		background-color: #f8f9fa;
		padding: 1rem;
		border-radius: 4px;
		font-family: monospace;
		font-size: 0.9rem;
	}

	.triple {
		margin-bottom: 0.5rem;
		padding: 0.5rem;
		background-color: white;
		border-radius: 4px;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.triple-number {
		font-weight: bold;
		margin-right: 0.5rem;
		color: #6c757d;
		min-width: 2rem;
	}

	.triple-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.triple-part {
		flex: 1 1 30%;
		min-width: 200px;
	}

	.alert {
		padding: 1rem;
		border-radius: 4px;
	}

	.alert-danger {
		background-color: #f8d7da;
		color: #721c24;
		border: 1px solid #f5c6cb;
	}
</style>

