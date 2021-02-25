const db = require('../lib/db');
const Project = require('../models/Project');

const seed = [
  'http://data.nobelprize.org/data/country/Saint_Lucia',
  'http://dbpedia.org/resource/Berlin'
];

db.once('open', () => {
  return Project.create({
      name:'test_proj',
      description: 'just testing out stuff',
      seedUrls: seed})
    .then((...args) => {
      console.log(args);
      process.exit(0)
    });
});








