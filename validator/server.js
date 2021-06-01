const morgan = require('morgan');
const express = require('express');
const app = express();
app.use(morgan('combined'));
const config = require('./config');
const fs = require('fs/promises');


app.get('/', (req, res) => {
  res.send('Up and running');
});



app.get('/sw/:resource', async (req, res) => {
  const fp = `./static/${req.get('host')}/${req.params.resource}.ttl`;
  const rdf = await fs.readFile(fp);
  res.setHeader('content-type', 'text/turtle');
  res.send(rdf);
});



app.listen(config.port, config.host);
console.log(`Running on http://${config.host}:${config.port}`);

