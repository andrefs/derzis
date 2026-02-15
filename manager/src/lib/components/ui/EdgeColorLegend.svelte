<script lang="ts">
  import { getPredicateColor, isPredicateSelected } from '$lib/utils';
  export let graphData: any = null;
  export let selectedPredicates: string[] = [];
  export let state: {
    hoveredNode?: string;
    hoveredNeighbors?: Set<string>;
    locked?: boolean;
    highlightedNodes?: Set<string>;
    addedLevels?: Set<string>[];
    labelHoveredNode?: string;
  };
</script>

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
          (predicate: string) =>
            selectedPredicates.length === 0 || selectedPredicates.includes(predicate)
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

<style>
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
</style>
