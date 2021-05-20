const db = require('../lib/db');
const Resource = require('../models/Resource');

const seeds = [
  //'http://data.nobelprize.org/data/country/Saint_Lucia',
  //'http://dbpedia.org/resource/Berlin',
  //'http://dbpedia.org/resource/Emmental_cheese',
  //'http://dbpedia.org/resource/Cheddar_cheese',
  //'http://dbpedia.org/resource/Mozzarella',
  //'http://dbpedia.org/resource/Roquefort',
  //'http://dbpedia.org/resource/Gouda_cheese'


  'http://www.wikidata.org/entity/Q41225', // Big Ben
  'http://www.wikidata.org/entity/Q243', // Eiffel Tower
  'http://www.wikidata.org/entity/Q9141', // Taj Mahal
  'http://www.wikidata.org/entity/Q82425', // Brandenburg Gate
  'http://www.wikidata.org/entity/Q5788', // Petra
  'http://www.wikidata.org/entity/Q10285', // Colosseum

];

db.once('open', () => {
  return Resource.insertSeeds(seeds)
    .then(paths => Resource.addPaths(paths))
    .then((...args) => {
      console.log(JSON.stringify(args, null, 2));
      process.exit(0)
    });
});








