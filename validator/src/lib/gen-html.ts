import { SimpleTriple } from '@derzis/common';
import Handlebars from 'handlebars';

const cdnLinks = [
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/sigma.js/2.4.0/sigma.min.js"></script>',
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/graphology/0.25.4/graphology.umd.min.js"></script>',
  '<script src=""></script>',
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
  </head>
  <body style="background: lightgrey">
    <div id="container" style="width: 800px; height: 600px; background: white"></div>
    <script>


      // Create a graphology graph
			const graph = new graphology.Graph({ type: 'directed', multi: true, allowSelfLoops: true });
      {{#each triples}}
      {
        const subColor = "{{subject}}".match(/seed/) ? "green" : "orange";
        const objColor = "{{object}}".match(/seed/) ? "green" : "orange";
        graph.mergeNode("{{subject}}", { label: "{{subject}}", x: Math.random(), y: Math.random(), size: 10, color: subColor });
        graph.mergeNode("{{object}}", { label: "{{object}}", x: Math.random(), y: Math.random(), size: 10, color: objColor });
        graph.addEdge("{{subject}}", "{{object}}", { size: 1, color: "grey" });


			  // increase size logarithmically based on degree
			  graph.updateNodeAttribute("{{subject}}", 'size', (size) =>
			  	size ? Math.log(size + 1) * 5 : 1
			  );
			  graph.updateNodeAttribute("{{object}}", 'size', (size) =>
			  	size ? Math.log(size + 1) * 5 : 1
			  );
      }
      {{/each}}

	
			const sensibleSettings = graphologyLibrary.layoutForceAtlas2.inferSettings(graph);
			const fa2Layout = new graphologyLibrary.FA2Layout(graph,{
				settings: sensibleSettings
			});
			function startFA2() {
				fa2Layout.start();
			}
			// Start FA2
			startFA2();
			setTimeout(() => {
				fa2Layout.stop();
			}, 10 * 1000);


//graphologyLibrary.layoutForceAtlas2.assign(graph, { iterations: 100 });

      // Instantiate sigma.js and render the graph
      const sigmaInstance = new Sigma(graph, document.getElementById("container"));
    </script>
  </body>
</html>
`);

  return template({ triples, cdnLinks });
}
