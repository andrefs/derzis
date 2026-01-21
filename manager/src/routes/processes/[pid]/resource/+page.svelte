<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Tooltip } from '@sveltestrap/sveltestrap';

	export let data;

	let turtleParts: { parts: { type: string; content: string }[]; inProcess: boolean }[] = [];
	let urlInput = data.url || '';

	// Reactive statement to generate turtle when data changes
	$: if (data.triples && data.triples.length > 0) {
		generateTurtle();
	} else {
		turtleParts = [];
	}

	function generateTurtle() {
		if (!data.triples || data.triples.length === 0) {
			turtleParts = [];
			return;
		}

		turtleParts = [];

		// Manually format as N-Triples and sort by inProcess (true first)
		const formattedParts = data.triples.map(triple => {
			const tripleText = `<${triple.subject}> <${triple.predicate}> <${triple.object}> .`;

			// Parse URLs from the triple text
			const urlRegex = /<([^>]+)>/g;
			const parts = [];
			let lastIndex = 0;
			let match;

			while ((match = urlRegex.exec(tripleText)) !== null) {
				// Add text before the URL
				if (match.index > lastIndex) {
					parts.push({
						type: 'text',
						content: tripleText.slice(lastIndex, match.index)
					});
				}

				// Add the URL as a link
				parts.push({
					type: 'url',
					content: match[1] // The URL without angle brackets
				});

				lastIndex = match.index + match[0].length;
			}

			// Add remaining text
			if (lastIndex < tripleText.length) {
				parts.push({
					type: 'text',
					content: tripleText.slice(lastIndex)
				});
			}

			return {
				parts,
				inProcess: triple.inProcess
			};
		});

		// Sort: inProcess triples first, then non-inProcess triples
		formattedParts.sort((a, b) => {
			if (a.inProcess && !b.inProcess) return -1;
			if (!a.inProcess && b.inProcess) return 1;
			return 0;
		});

		turtleParts = formattedParts;
	}

	function handleSubmit(event: Event) {
		event.preventDefault();
		const formData = new FormData(event.target as HTMLFormElement);
		const newUrl = formData.get('url') as string;
		if (newUrl) {
			goto(`/processes/${data.process.pid}/resource?url=${encodeURIComponent(newUrl)}`);
		}
	}
</script>

<main>
	<h2>Resource Triples for Process {data.process.pid}</h2>

	<form on:submit={handleSubmit} style="margin-bottom: 2rem;">
		<label for="url">Resource URL:</label>
		<input
			type="text"
			id="url"
			name="url"
			bind:value={urlInput}
			placeholder="Enter resource URL"
			style="width: 70%; margin-right: 1rem;"
		/>
		<button type="submit">Find</button>
	</form>

	{#if data.triples && data.triples.length > 0}
		<div>
			<h3>Triples ({data.triples.length})</h3>
			<p><em>Triples in grey are not found in this process's ProcessTriple collection.</em></p>
			<div
				style="background-color: #f8f9fa; padding: 1rem; border-radius: 4px; overflow-x: auto; white-space: nowrap; font-family: monospace; width: max-content; min-width: 100%;"
			>
				{#each turtleParts as part, i}
					{#if part.inProcess}
						<div style="color: black; margin-bottom: 0.5rem;">
							{#each part.parts as partItem}
								{#if partItem.type === 'url'}
									<a href="/processes/{data.process.pid}/resource?url={encodeURIComponent(partItem.content)}" style="color: inherit; text-decoration: none;">
										&lt;{partItem.content}&gt;
									</a>
								{:else}
									{partItem.content}
								{/if}
							{/each}
						</div>
					{:else}
						<Tooltip target="triple-{i}" placement="top">
							This triple does not belong to this process' graph.
						</Tooltip>
						<div id="triple-{i}" style="color: grey; margin-bottom: 0.5rem;">
							{#each part.parts as partItem}
								{#if partItem.type === 'url'}
									<a href="/processes/{data.process.pid}/resource?url={encodeURIComponent(partItem.content)}" style="color: inherit; text-decoration: none;">
										&lt;{partItem.content}&gt;
									</a>
								{:else}
									{partItem.content}
								{/if}
							{/each}
						</div>
					{/if}
				{/each}
			</div>
		</div>
	{:else if data.url}
		<p>No triples found for this resource URL.</p>
	{:else}
		<p>Enter a resource URL above to view its triples.</p>
	{/if}
</main>
