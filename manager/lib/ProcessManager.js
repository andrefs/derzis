const Process = require('../models/Process');
const express = require('express');
const exphbs  = require('express-handlebars');
const path = require('path');
//const { v4: uuidv4 } = require('uuid');
const log = require('../../common/lib/logger')('Manager');
const swaggerUi = require('swagger-ui-express');
const docs = require('../docs');



const app = express();

const hbs = exphbs.create({
  helpers: {
    ifEquals: function(arg1, arg2, options) {
      return (arg1 == arg2) ? options.fn(this) : options.inverse(this);
    },
    join: function(arg1, arg2, options){
      return [...arg1].join(arg2);
    }
  },
  extname: '.hbs'
});

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
  const ps = await Process.find().lean();
  const _ps = ps.map(p => {p.createdAt = p.createdAt.toISOString(); return p;});
  res.render('process-list', {processes: _ps, page_name: 'processes'});
});

app.get('/processes/new', (req, res) => {
  res.render('process-form', {page_name: 'add_new'});
});


app.get('/processes/:pid', async (req, res) => {
  const p = await Process.findOne({pid: req.params.pid}).lean();
  p.createdAt = p.createdAt?.toISOString();
  p.updatedAt = p.updateAt?.toISOString() || p.createdAt;
  p.notification.email = p.notification.email
                            .replace(/(?<=.).*?(?=.@)/, x => '*'.repeat(x.length))
                            .replace(/^..(?=@)/, '**');
  const host = req.protocol + '://' + req.get('host');
  res.render('process', {process: p, host});
});

app.post('/processes', async (req, res, next) => {
  log.debug('', req.body); 
  log.debug('', req.body.seeds); 
  const seeds = [...new Set(req.body.seeds.split(/\s*[\n,]\s*/))];
  const p = await Process.create({
    params: {
      maxPathLength: req.body.maxPathLength,
      maxPathProps:  req.body.maxPathProps
    },
    notification: {
      email: req.body.email,
      webhook: req.body.webhook
    },
    seeds
  });
  res.redirect(303, '/processes/'+p.pid);
});


module.exports = app;
