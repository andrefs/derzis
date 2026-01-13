<script lang="ts">
	export let graphData: any = null;
	export let selectedPredicate: string = 'all';
	export let state: {
		hoveredNode?: string;
		hoveredNeighbors?: Set<string>;
		locked?: boolean;
		highlightedNodes?: Set<string>;
		addedLevels?: Set<string>[];
		labelHoveredNode?: string;
	};
	export let getPredicateColor: (predicate: string) => string;
</script>

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
				.map((edge: string) => (graphData.getEdgeAttributes(edge) as any).fullPredicate as string)
				.filter(
					(predicate: string) => selectedPredicate === 'all' || predicate === selectedPredicate
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
