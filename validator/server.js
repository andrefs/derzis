const morgan = require('morgan');
const express = require('express');
const app = express();
app.use(morgan('combined'));
const config = require('./config');

const {results, rdf, tests} = require('./tests');


app.get('/', (req, res) => {
  res.send('Up and running');
});

app.get('/sw/:resource', async (req, res) => {
  const r = req.params.resource;
  if(r.match(/^t(\d+)\w\d+$/)){
    const testNum = RegExp.$1;

    if(tests['test'+testNum].resources[r]?.required){  delete results.unreached[r]; }
    if(tests['test'+testNum].resources[r]?.forbidden){ results.forbidden[r] = tests['test'+testNum].resources[r].reason; }
    results.reached++;

    console.log(results);

    res.setHeader('content-type', 'text/turtle');
    res.send(rdf[r]);
  } else {
    res.send(404);
  }
});

app.get('/results', (req, res) => {
  res.setHeader('content-type', 'application/json');
  res.send(results);
});



app.listen(config.port, config.host);
console.log(`Running on http://${config.host}:${config.port}`);

