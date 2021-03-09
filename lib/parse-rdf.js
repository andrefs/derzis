const Promise = require('bluebird');
const streamify = require('streamify-string');
const rdfParser = require('rdf-parse').default;

const parseResource = (rdf, mime) => {
  if(!rdf){ return Promise.resolve({triples:[]}); }
  let triples = [];
  return new Promise((resolve, reject) => rdfParser.parse(streamify(rdf), {contentType: mime})
    .on('data',  quad => triples.push(quad))
    .on('error', err  => reject(err))
    .on('end',   ()   => resolve({triples})));
};



module.exports = parseResource;
