const axios = require('axios');
const N3 = require('n3');
const parser = new N3.Parser();

const procUrl = async function(url){
  const response = await axios.get(url);
  let resources = {};
  let triples = [];

  return new Promise((resolve, reject) => {
    parser.parse(response.data, (err, quad, prefs) => {
      if(err){ reject(err); }
      else if(prefs){
        resolve({
          resources: Object.keys(resources),
          triples
        });
      } else {
        triples.push(quad);
        resources[quad.subject.value] = true;
        resources[quad.predicate.value] = true;
        if(quad.object.termType === 'NamedNode'){
          resources[quad.object.value] = true;
        }
      }
    });
  });
};

module.exports = procUrl;
