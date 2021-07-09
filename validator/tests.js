
const tests = {
  test01: {
    resources: {
      t01n01: {
        links: [['t01p01', 't01n02']],
        required: true
      },
      t01n02: {
        links: [['t01p02', 't01n03']],
        required: true
      },
      t01n03: {
        links: [['t01p03', 't01n04']],
        required: true
      },
      t01n04: {
        forbidden: true,
        reason: 'maxLengthExceeded'
      },
      t01p01: {
        forbidden: true,
        reason: 'maxPropsExceeded'
      },
      t01p02: {
        forbidden: true,
        reason: 'maxPropsExceeded'
      },
      t01p03: {
        forbidden: true,
        reason: 'maxPropsExceeded'
      }
    },
    config: {
      maxLength: 3,
      maxProps: 3
    }
  },
  test02: {
    resources: {
      t02n01: {
        links: [['t02p01', 't02n02']],
        required: true
      },
      t02n02: {
        links: [['t02p02', 't02n03']],
        required: true
      },
      t02n03: {
        links: [['t02p03', 't02n04']],
        forbidden: true,
        reason: 'maxPropsExceeded'
      },
      t02n04: {
        forbidden: true,
        reason: 'maxLengthExceeded'
      },
      t02p01: {
        forbidden: true,
        reason: 'maxPropsExceeded'
      },
      t02p02: {
        forbidden: true,
        reason: 'maxPropsExceeded'
      },
      t02p03: {
        forbidden: true,
        reason: 'maxPropsExceeded'
      }
    },
    config: {
      maxLength: 3,
      maxProps: 1
    }
  },
};

const rdfPrefixes = `@prefix dvex1: <http://derzis-val01.example.org/sw/> .
`;

const genTriple = (s,p,o) => {
  let res = '';
  res += s.match(/^https?:\/\//) ? s : 'dvex1:'+s;
  res += p.match(/^https?:\/\//) ? p : ' dvex1:'+p;
  res += o.match(/^https?:\/\//) ? o : ' dvex1:'+o;
  res += ' .';

  return res;
};

const procTests = tests => {
  const results = {
    forbidden: {},
    unreached: {},
    total: 0,
    required: 0,
    reached: 0
  };
  const rdf = {};

  for(const [k,v] of Object.entries(tests)){
    for(const [n, nInfo] of Object.entries(v.resources)){
      rdf[n] = rdfPrefixes;
      const triples = nInfo
                  ?.links
                  ?.map(l => genTriple(n, l[0], l[1]))
                  ?.join('\n');
      if(triples){ rdf[n] += triples; }
      if(nInfo.required){
        results.required++;
        results.unreached[n] = true;
      }
      results.total++;
    }
  }

  return {results, rdf, tests};
};

module.exports = procTests(tests);
