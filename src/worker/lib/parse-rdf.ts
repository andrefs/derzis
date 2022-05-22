import Bluebird from 'bluebird';
import streamify from 'streamify-string';
import rdfParser from 'rdf-parse';
import * as RDF from "@rdfjs/types";

interface parsedRdf {
  triples: RDF.Quad[]
};

const parseRdf = (rdf:string, mime: string): Promise<parsedRdf> => {
  let triples: RDF.Quad[] = [];
  if(!rdf){ return Bluebird.resolve({triples}); }
  console.warn(rdfParser)
  return new Bluebird((resolve, reject) => rdfParser.parse(streamify(rdf), {contentType: mime})
    .on('data',  quad => triples.push(quad))
    .on('error', err  => reject(err))
    .on('end',   ()   => resolve({triples})));
};

export default parseRdf;
