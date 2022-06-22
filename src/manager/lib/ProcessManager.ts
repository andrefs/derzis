import {Process, ProcessDocument} from '@derzis/models';
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

const app = express();
app.use(morganMiddleware);
//app.use(compression());

const hbs = create({
  helpers: {
    ifEquals: function(arg1: any, arg2: any, options: any) {
      return (arg1 == arg2) ? options.fn(this) : options.inverse(this);
    },
    join: function(arg1: any, arg2: any){
      return [...arg1].join(arg2);
    }
  },
  extname: '.hbs'
});

app.locals.version = pjson.version;

app.engine('.hbs', hbs.engine);
app.set('views', path.join(__dirname, '..', 'views'));
app.set('view engine', '.hbs');
app.use(express.static(path.join(__dirname, '..', 'public')));


app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(docs));

//app.use(bodyParser.json());
app.use(express.urlencoded({
  extended: true
}));

app.get('/processes', async (req, res) => {
  const ps: ProcessDocument[] = await Process.find().lean();
  const _ps = ps.map(p => ({...p, createdAt: p.createdAt.toISOString()}));
  res.render('process-list', {processes: _ps, page_name: 'processes'});
});

app.get('/processes/new', (req, res) => {
  res.render('process-form', {page_name: 'add_new'});
});


app.get('/processes/:pid', async (req, res) => {
  const _p: ProcessDocument = await Process.findOne({pid: req.params.pid}).lean();
  const p = {
    ..._p,
    createdAt: _p.createdAt?.toISOString(),
    updatedAt: _p.updatedAt?.toISOString() || _p.createdAt,
    notification: {
      ..._p.notification,
      email: _p.notification.email
                            .replace(/(?<=.).*?(?=.@)/, x => '*'.repeat(x.length))
                            .replace(/^..(?=@)/, '**')
    }
  };
  const host = req.protocol + '://' + req.get('host');
  res.render('process', {process: p, host});
});

app.post('/processes', async (req, res) => {
  const seeds = req.body.seeds
                      .flatMap((s: string) => s.split(/\s*[\n,]\s*/))
                      .filter((s: string) => !s.match(/^\s*$/));
  const uniqueSeeds = [...new Set(seeds)];
  const p = await Process.create({
    params: {
      maxPathLength: req.body.maxPathLength,
      maxPathProps:  req.body.maxPathProps
    },
    notification: {
      email: req.body.email,
      webhook: req.body.webhook
    },
    seeds: uniqueSeeds
  });
  await Process.startNext();
  res.redirect(303, '/processes/'+p.pid);
});

app.get('/processes/:pid/triples', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  //res.setHeader('Content-Disposition', 'attachment; filename="triples.json"');
  res.write('[\n')
  const p = await Process.findOne({pid: req.params.pid});
  if(!p){ return res.status(404); }

  const iter = p?.getTriplesJson();
  const readable = stream.Readable.from(iter, {encoding: 'utf8'});
  let i=0;
  const transform = new stream.Transform({
    transform: (triple, _, callback) => {
      const res = i === 0 ? '  '+triple : ',\n  '+triple;
      i++;
      callback(null, res)
    }
  });
  readable.pipe(transform).pipe(res, {end: false});
  readable.on('end', () => Readable.from('\n]').pipe(res));
});


export default app;
