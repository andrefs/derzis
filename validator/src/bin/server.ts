import fs from 'fs';
import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import { parseTriples } from '../lib/triples';
import { engine } from 'express-handlebars';

const graphId = process.argv[2];
if (!graphId) {
  console.error('Usage: ts-node src/bin/server.ts <graphId>');
  process.exit(1);
}
const graphFolder = path.join(__dirname, '..', '..', 'data', graphId);
console.log(`Loading graph from ${graphFolder}`);
const rdfData = fs.readFileSync(`${graphFolder}/data.ttl`, 'utf-8');
const tripleHash = parseTriples(rdfData);


const app = express();
app.engine('hbs', engine({ extname: '.hbs' }));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, '../views'));
// Serve static files from the "public" directory
// app.use(express.static(path.join(__dirname, '../public')));


const now = () => new Date().toISOString();

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${now()} - ${req.method} ${req.originalUrl} - Host: ${req.hostname} - IP: ${req.ip}`);
  next();
});


app.get('/', (req: Request, res: Response) => {
  res.send('Up and running');
});

app.get('/robots.txt', (req: Request, res: Response) => {
  res.type('text/plain');
  res.render('robots', { layout: false });
});

app.get('/sw/:type-:num', (req: Request, res: Response) => {
  const { type, num } = req.params;
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  // return turtle data for the requested resource
  const triples = tripleHash[url];
  if (!triples) {
    res.status(404).send('Not found');
    return;
  }
  res.type('text/turtle');
  res.send(triples.join('\n'));
})

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('Server is running on http://localhost:' + port);
  console.log(`Loaded triples from ${graphFolder}/data.ttl}:`);
  console.log(tripleHash);
})
