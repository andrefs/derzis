import Bluebird from 'bluebird';
import streamify from 'streamify-string';
import rdfParser from 'rdf-parse';
import * as RDF from "@rdfjs/types";

interface parsedRdf {
  triples: RDF.Quad[],
  errors: Error[]
};

const parseRdf = (rdf:string, mime: string): Promise<parsedRdf> => {
  let triples: RDF.Quad[] = [];
  let errors: Error[] = [];
  if(!rdf){ return Bluebird.resolve({triples}); }
  return new Bluebird((resolve) => rdfParser.parse(streamify(rdf), {contentType: mime})
    .on('data',  quad => triples.push(quad))
    .on('error', err  => errors.push(err))
    .on('end',   ()   => resolve({triples, errors})));
};

export default parseRdf;
