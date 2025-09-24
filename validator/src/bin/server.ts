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

// Request/response logging middleware (logs method, url, status and duration)
// Controlled by NODE_ENV and LOG_REQUESTS (set LOG_REQUESTS=true to force logging)
//const shouldLogRequests = process.env.NODE_ENV !== 'production' || process.env.LOG_REQUESTS === 'true';
const shouldLogRequests = true; // Always log for this server
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!shouldLogRequests) {
    return next();
  }

  // Log when the request is received so we have a trace even if the request hangs
  console.log(`${now()} - -> ${req.method} ${req.protocol}://${req.get('host')}${req.originalUrl}`);

  const start = process.hrtime();
  res.on('finish', () => {
    const diff = process.hrtime(start);
    const durationMs = (diff[0] * 1e3) + (diff[1] / 1e6);
    const base = `${now()} - <- ${req.method} ${req.originalUrl} - ${res.statusCode} ${res.statusMessage || ''} - ${durationMs.toFixed(3)} ms - Host: ${req.hostname}`;
    if (res.statusCode >= 500) {
      console.error(base);
    } else if (res.statusCode >= 400) {
      console.warn(base);
    } else {
      console.log(base);
    }
  });
  next();
});


app.get('/debug/triple-hash', (req: Request, res: Response) => {
  res.json(tripleHash);
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
  // send triples as turtle
  res.send(triples.map(t => `<${t.subject}> <${t.predicate}> <${t.object}> .`).join('\n'));
})

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('Server is running on http://localhost:' + port);
  console.log(`Loaded triples from ${graphFolder}/data.ttl}:`);
  //console.log(tripleHash);
})
