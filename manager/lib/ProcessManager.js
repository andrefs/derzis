const Process = require('../models/Process');
const express = require('express');
const exphbs  = require('express-handlebars');
const path = require('path');
//const { v4: uuidv4 } = require('uuid');



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
  res.render('process', {process: p});
});

app.post('/processes', async (req, res, next) => {
  const p = await Process.create({
    email: req.body.email,
    seeds: req.body.seeds.split(/\s*\n\s*/),
  });
  res.redirect(303, '/processes/'+p.pid);
});


module.exports = app;
