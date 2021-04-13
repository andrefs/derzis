const db = require('../lib/db');
const Resource = require('../models/Resource');

const seeds = [
  //'http://data.nobelprize.org/data/country/Saint_Lucia',
  //'http://dbpedia.org/resource/Berlin',
  'http://dbpedia.org/resource/Emmental_cheese',
  'http://dbpedia.org/resource/Cheddar_cheese',
  'http://dbpedia.org/resource/Mozzarella',
  'http://dbpedia.org/resource/Roquefort',
  'http://dbpedia.org/resource/Gouda_cheese'
];

db.once('open', () => {
  return Resource.insertSeeds(seeds)
    .then((...args) => {
      console.log(args);
      process.exit(0)
    });
});








