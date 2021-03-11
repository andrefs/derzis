const db = require('../lib/db');
const Triple = require('../models/Triple');
const process = require('process');
const fs = require('fs');
const stream = fs.createWriteStream(process.argv[2]|| 'dump.nt');
const N3 = require('n3');
const writer = new N3.Writer(stream, {end: false, format: 'N-Triples'});
const {namedNode} = N3.DataFactory;


db.once('open', dumpTriples);

async function dumpTriples(){
  for await (const t of Triple.find()){
    writer.addQuad(
      namedNode(t.subject),
      namedNode(t.predicate),
      namedNode(t.object)
    );
  }
  writer.end();
  db.close();
};

