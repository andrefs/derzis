import { SimpleTriple } from '@derzis/common';
import Handlebars from 'handlebars';

const cdnLinks = [
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/sigma.js/2.4.0/sigma.min.js"></script>',
  '<script src="https://cdn.jsdelivr.net/npm/graphology@0.26.0/dist/graphology.umd.min.js"></script>',
  '<script src="https://cdn.jsdelivr.net/npm/graphology-library/dist/graphology-library.min.js"></script>'
]

export function genPage(triples: SimpleTriple[]) {
  const template = Handlebars.compile(`
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Quick Sigma.js Example</title>
    {{#each cdnLinks}}
    {{{this}}}
    {{/each}}
    <style>
      body { background: lightgrey; }
      #container { width: 800px; height: 600px; background: white; margin: 20px auto; }
    </style>
  </head>
  <body>
    <div id="container"></div>
    <script>
      // Create a graphology graph
      const graph = new graphology.Graph({ type: 'directed', multi: true, allowSelfLoops: true });

      // Track seed nodes so we can place them on a circle
      const seedNodes = new Set();

      // Create nodes and edges from triples
      {{#each triples}}
      {
        const sub = "{{subject}}";
        const obj = "{{object}}";
        const subIsSeed = /seed/.test(sub);
        const objIsSeed = /seed/.test(obj);

        const subColor = subIsSeed ? "green" : "orange";
        const objColor = objIsSeed ? "green" : "orange";

        // Give non-seed nodes a random initial position to help FA2
        const randPos = () => ({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2 });

        if (!graph.hasNode(sub)) {
          const pos = subIsSeed ? { x: 0, y: 0 } : randPos();
          graph.mergeNode(sub, { label: sub, x: pos.x, y: pos.y, size: 8, color: subColor, fixed: !!subIsSeed });
        }

        if (!graph.hasNode(obj)) {
          const pos = objIsSeed ? { x: 0, y: 0 } : randPos();
          graph.mergeNode(obj, { label: obj, x: pos.x, y: pos.y, size: 8, color: objColor, fixed: !!objIsSeed });
        }

        graph.addEdge(sub, obj, { size: 1, color: "grey" });

        if (subIsSeed) seedNodes.add(sub);
        if (objIsSeed) seedNodes.add(obj);

        // increase size logarithmically based on degree
        graph.updateNodeAttribute(sub, 'size', (size) =>
          size ? Math.log(size + 1) * 5 : 1
        );
        graph.updateNodeAttribute(obj, 'size', (size) =>
          size ? Math.log(size + 1) * 5 : 1
        );
      }
      {{/each}}

      // Function to place seed nodes on a centered circle
      function placeSeedsOnCircle() {
        const seeds = Array.from(seedNodes);
        if (seeds.length === 0) return;

        // Centered in graph coordinate space (sigma centers around 0,0)
        const centerX = 0;
        const centerY = 0;
        const radius = 30.0; // radius in graph coordinate units

        seeds.forEach((nodeId, i) => {
          const angle = (2 * Math.PI * i) / seeds.length;
          const x = centerX + radius * Math.cos(angle);
          const y = centerY + radius * Math.sin(angle);

          // Set the node position and color/size explicitly and mark as fixed
          graph.setNodeAttribute(nodeId, 'x', x);
          graph.setNodeAttribute(nodeId, 'y', y);
          graph.setNodeAttribute(nodeId, 'size', 12);
          graph.setNodeAttribute(nodeId, 'color', 'green');
          graph.setNodeAttribute(nodeId, 'fixed', true);
        });
      }

      // Initial placement of seeds before running layout
      placeSeedsOnCircle();

      // Infer FA2 settings and create a layout runner
      const sensibleSettings = graphologyLibrary.layoutForceAtlas2.inferSettings(graph);
      const fa2Layout = new graphologyLibrary.FA2Layout(graph, {
        settings: sensibleSettings
      });

      // Start FA2 to arrange non-seed nodes around the seeded circle
      fa2Layout.start();

      // Instantiate sigma.js so we can see the live layout
      const sigmaInstance = new Sigma(graph, document.getElementById("container"));

      // Stop FA2 after some time, then reassert seed positions to keep them on the circle
      setTimeout(() => {
        fa2Layout.stop();

        const seeds = Array.from(seedNodes);
        if (seeds.length > 0) {
          const centerX = 0;
          const centerY = 0;
          const radius = 30.0;

          seeds.forEach((nodeId, i) => {
            const angle = (2 * Math.PI * i) / seeds.length;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            graph.setNodeAttribute(nodeId, 'x', x);
            graph.setNodeAttribute(nodeId, 'y', y);

            // Ensure they remain fixed and visually prominent
            graph.setNodeAttribute(nodeId, 'size', 14);
            graph.setNodeAttribute(nodeId, 'color', 'green');
            graph.setNodeAttribute(nodeId, 'fixed', true);
          });

          // Refresh sigma renderer to reflect final positions
          sigmaInstance.refresh();
        }
      }, 10 * 1000);

    </script>
  </body>
</html>
`);

  return template({ triples, cdnLinks });
}
