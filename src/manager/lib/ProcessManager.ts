import { Process, ProcessDocument, Resource } from '@derzis/models';
import express from 'express';
import { create } from 'express-handlebars';
import path from 'path';
//const { v4: uuidv4 } = require('uuid');
import swaggerUi from 'swagger-ui-express';
import * as docs from '../docs';
import morganMiddleware from './morganMiddleware';
import stream, { Readable } from 'stream';
//import compression from 'compression';
import pjson from '../../../package.json';
import zlib from 'zlib';

const app = express();
app.use(morganMiddleware);
//app.use(compression());
//

const secondsToString = (seconds: number) => {
  const numYears = Math.floor(seconds / 31536000);
  const numDays = Math.floor((seconds % 31536000) / 86400);
  const numHours = Math.floor(((seconds % 31536000) % 86400) / 3600);
  const numMinutes = Math.floor((((seconds % 31536000) % 86400) % 3600) / 60);
  const numSeconds = Math.round((((seconds % 31536000) % 86400) % 3600) % 60);
  let res = [];
  if (numYears) {
    res.push(numYears > 1 ? `${numYears} years` : `1 year`);
  }
  if (numDays) {
    res.push(numDays > 1 ? `${numDays} days` : `1 day`);
  }
  if (numHours) {
    res.push(numHours > 1 ? `${numHours} hours` : `1 hour`);
  }
  if (numMinutes) {
    res.push(numMinutes > 1 ? `${numMinutes} minutes` : `1 minute`);
  }
  if (numSeconds) {
    res.push(numSeconds > 1 ? `${numSeconds} seconds` : `1 second`);
  }
  return res.join(' ');
};

const hbs = create({
  helpers: {
    ifEquals: function (arg1: any, arg2: any, options: any) {
      return arg1 == arg2 ? options.fn(this) : options.inverse(this);
    },
    join: function (arg1: any, arg2: any) {
      return [...arg1].join(arg2);
    },
  },
  extname: '.hbs',
});

app.locals.version = pjson.version;

app.engine('.hbs', hbs.engine);
app.set('views', path.join(__dirname, '..', 'views'));
app.set('view engine', '.hbs');
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(docs));

//app.use(bodyParser.json());
app.use(
  express.urlencoded({
    extended: true,
  })
);

app.get('/processes', async (req, res) => {
  const ps: ProcessDocument[] = await Process.find().lean();
  const _ps = ps.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }));
  res.render('process-list', { processes: _ps, page_name: 'processes' });
});

app.get('/processes/new', (req, res) => {
  res.render('process-form', { page_name: 'add_new' });
});

app.get('/processes/:pid', async (req, res) => {
  const _p: ProcessDocument | null = await Process.findOne({
    pid: req.params.pid,
  }).lean();
  if (!_p) {
    return res.status(404);
  }

  const lastResource = await Resource.findOne().sort({ updatedAt: -1 });
  const timeRunning = lastResource
    ? (lastResource!.updatedAt.getTime() - _p.createdAt.getTime()) / 1000
    : null;
  const p = {
    ..._p,
    createdAt: _p.createdAt?.toISOString(),
    updatedAt: _p.updatedAt?.toISOString() || _p.createdAt,
    timeRunning: timeRunning ? secondsToString(timeRunning) : '',
    notification: {
      ..._p.notification,
      email: _p.notification.email
        .replace(/(?<=.).*?(?=.@)/, (x) => '*'.repeat(x.length))
        .replace(/^..(?=@)/, '**'),
    },
  };
  const host = req.protocol + '://' + req.get('host');
  res.render('process', { process: p, host });
});

app.get('/processes/last/stats', async (req, res) => {
  const p = await Process.findOne().sort({ createdAt: -1 });
  if (!p) {
    return res.status(404);
  }

  const stats = await p.getInfo();
  res.json(stats);
});

app.get('/processes/:pid/stats', async (req, res) => {
  const p = await Process.findOne({ pid: req.params.pid });
  if (!p) {
    return res.status(404);
  }

  const stats = await p.getInfo();
  res.json(stats);
});

app.post('/processes', async (req, res) => {
  const seeds: string[] = req.body.seeds
    .flatMap((s: string) => s.split(/\s*[\n,]\s*/))
    .filter((s: string) => !s.match(/^\s*$/));
  const uniqueSeeds = [...new Set(seeds)];

  const pathHeads: { [key: string]: number } = {};
  for (const s of seeds) {
    const domain = new URL(s).origin;
    pathHeads[domain] = pathHeads[domain] || 0;
    pathHeads[domain]++;
  }

  const p = await Process.create({
    params: {
      maxPathLength: req.body.maxPathLength,
      maxPathProps: req.body.maxPathProps,
    },
    notification: {
      email: req.body.email,
      webhook: req.body.webhook,
    },
    seeds: uniqueSeeds,
    pathHeads,
  });
  await Process.startNext();
  res.redirect(303, '/processes/' + p.pid);
});

app.get('/processes/last/triples', async (req, res) => {
  const p = await Process.findOne().sort({ createdAt: -1 });
  if (!p) {
    return res.status(404);
  }

  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="triples.json.gz"'
  );

  const gz = zlib.createGzip();

  const iter = p?.getTriplesJson();
  const readable = stream.Readable.from(iter, { encoding: 'utf8' });
  let i = 0;
  const transform = new stream.Transform({
    transform: (triple, _, callback) => {
      const res = i === 0 ? '  ' + triple : ',\n  ' + triple;
      i++;
      callback(null, res);
    },
  });

  Readable.from('[\n').pipe(gz, { end: false });
  readable.pipe(transform).pipe(gz, { end: false });
  readable.on('end', () => Readable.from('\n]').pipe(gz));
  gz.pipe(res);
});

app.get('/processes/:pid/triples', async (req, res) => {
  const p = await Process.findOne({ pid: req.params.pid });
  if (!p) {
    return res.status(404);
  }

  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="triples.json.gz"'
  );

  const gz = zlib.createGzip();

  const iter = p?.getTriplesJson();
  const readable = stream.Readable.from(iter, { encoding: 'utf8' });
  let i = 0;
  const transform = new stream.Transform({
    transform: (triple, _, callback) => {
      const res = i === 0 ? '  ' + triple : ',\n  ' + triple;
      i++;
      callback(null, res);
    },
  });

  Readable.from('[\n').pipe(gz, { end: false });
  readable.pipe(transform).pipe(gz, { end: false });
  readable.on('end', () => Readable.from('\n]').pipe(gz));
  gz.pipe(res);
});

export default app;
