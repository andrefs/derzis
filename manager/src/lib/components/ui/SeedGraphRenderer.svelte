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
  export let nodeMaxCreatedAt: Map<string, Date> = new Map();
  export let minDate: Date = new Date();
  export let maxDate: Date = new Date();
  export let seeds: string[];
  export let nodeHops: Map<string, number>;
  export let locked: boolean = false;
  export let enableNodeClick: boolean = true;
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
      if (!container) return; // Wait for container to be mounted
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

      const hopColors = [
        '#ff0000', // Hop 0: Red (seeds)
        '#0000ff', // Hop 1: Blue
        '#00c800', // Hop 2: Green
        '#ffff00', // Hop 3: Yellow
        '#800080', // Hop 4: Purple
        '#ffa500', // Hop 5: Orange
        '#00ffff', // Hop 6: Cyan
        '#ff00ff', // Hop 7: Magenta
        '#808080' // Hop 8+: Gray
      ];

      function getHopColor(hop: number): string {
        if (hop < hopColors.length) {
          return hopColors[hop];
        }
        return hopColors[hopColors.length - 1]; // Gray for higher hops
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
        const hop = nodeHops.get(node) ?? 0;
        graph.setNodeAttribute(node, 'color', getHopColor(hop));
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

      const nodeReducer = (node: string, data: NodeDisplayData & { displayLabel?: string }): Partial<NodeDisplayData> => {
        const res: Partial<NodeDisplayData> = { ...data };
        const isSeed = seeds.includes(node);

        if (
          state.hoveredNeighbors &&
          !state.hoveredNeighbors.has(node) &&
          state.hoveredNode !== node
        ) {
          res.label = '';
          res.color = '#f6f6f6';
        } else if (
          state.hoveredNode === node ||
          (state.hoveredNeighbors && state.hoveredNeighbors.has(node))
        ) {
          // Show label for hovered nodes (both seeds and non-seeds)
          res.label = data.displayLabel || node;
        }

        if (state.highlightedNodes && state.highlightedNodes.has(node)) {
          res.highlighted = true;
        }

        if (addedLevels) {
          for (let i = 0; i < addedLevels.length; i++) {
            if (addedLevels[i].has(node)) {
              res.forceLabel = true;
              res.label = data.displayLabel || node;
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
      if (enableNodeClick) {
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
              const x =
                nodePosition * ratio * Math.cos(-angle) - nodePositionY * ratio * Math.sin(-angle);
              const y =
                nodePosition * ratio * Math.sin(-angle) + nodePositionY * ratio * Math.cos(-angle);

              renderer.getCamera().setState({
                x: x,
                y: y,
                ratio: ratio,
                angle: angle
              });
            }
          }
        });
      }

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
        graphData.forEachDirectedEdge(
          node,
          (edge: string, attributes: any, source: string, target: string) => {
            if (source === node) neighbors.add(target);
            if (target === node) neighbors.add(source);
          }
        );
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
