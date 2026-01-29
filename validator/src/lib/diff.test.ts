import { describe, it, expect } from 'vitest';
import { diffTripleArrays, sortTripleArray } from './diff';
import * as jsondiffpatch from 'jsondiffpatch';

describe('sortTripleArray', () => {
  it('should sort an array of SimpleTriple objects', () => {
    const triples = [
      { subject: 'B', predicate: 'p1', object: 'o1' },
      { subject: 'A', predicate: 'p2', object: 'o2' },
      { subject: 'A', predicate: 'p1', object: 'o3' },
      { subject: 'B', predicate: 'p1', object: 'o0' }
    ];
    const sorted = [
      { subject: 'A', predicate: 'p1', object: 'o3' },
      { subject: 'A', predicate: 'p2', object: 'o2' },
      { subject: 'B', predicate: 'p1', object: 'o0' },
      { subject: 'B', predicate: 'p1', object: 'o1' }
    ];
    expect(sortTripleArray(triples)).toEqual(sorted);
  });
});

describe('diffTripleArrays', () => {
  it('should return no differences for identical arrays', () => {
    const arr1 = [
      { subject: 'A', predicate: 'p1', object: 'o1' },
      { subject: 'B', predicate: 'p2', object: 'o2' }
    ];
    const arr2 = [
      { subject: 'A', predicate: 'p1', object: 'o1' },
      { subject: 'B', predicate: 'p2', object: 'o2' }
    ];
    const diff = diffTripleArrays(arr1, arr2);
    expect(diff).toBeUndefined();
  });

  it('should return differences for different arrays', () => {
    const arr1 = [
      { subject: 'A', predicate: 'p1', object: 'o1' },
      { subject: 'B', predicate: 'p2', object: 'o2' }
    ];
    const arr2 = [
      { subject: 'A', predicate: 'p1', object: 'o1' },
      { subject: 'B', predicate: 'p2', object: 'o3' }
    ];
    const diff = diffTripleArrays(arr1, arr2);
    expect(diff).toMatchInlineSnapshot(`
      {
        "1": {
          "object": [
            "o2",
            "o3",
          ],
        },
        "_t": "a",
      }
    `);
  });

  it('should handle different lengths of arrays', () => {
    const arr1 = [
      { subject: 'A', predicate: 'p1', object: 'o1' }
    ];
    const arr2 = [
      { subject: 'A', predicate: 'p1', object: 'o1' },
      { subject: 'B', predicate: 'p2', object: 'o2' }
    ];
    const diff = diffTripleArrays(arr1, arr2);
    expect(diff).toMatchInlineSnapshot(`
      {
        "1": [
          {
            "object": "o2",
            "predicate": "p2",
            "subject": "B",
          },
        ],
        "_t": "a",
      }
    `);
  });

  it('should handle triple deletions', () => {
    const arr1 = [
      { subject: 'A', predicate: 'p1', object: 'o1' },
      { subject: 'B', predicate: 'p2', object: 'o2' }
    ];
    const arr2 = [
      { subject: 'A', predicate: 'p1', object: 'o1' }
    ];
    const diff = diffTripleArrays(arr1, arr2);
    expect(diff).toMatchInlineSnapshot(`
      {
        "_1": [
          {
            "object": "o2",
            "predicate": "p2",
            "subject": "B",
          },
          0,
          0,
        ],
        "_t": "a",
      }
    `);
  })

  it('should handle triple additions', () => {
    const arr1 = [
      { subject: 'A', predicate: 'p1', object: 'o1' }
    ];
    const arr2 = [
      { subject: 'A', predicate: 'p1', object: 'o1' },
      { subject: 'B', predicate: 'p2', object: 'o2' }
    ];
    const diff = diffTripleArrays(arr1, arr2);
    expect(diff).toMatchInlineSnapshot(`
      {
        "1": [
          {
            "object": "o2",
            "predicate": "p2",
            "subject": "B",
          },
        ],
        "_t": "a",
      }
    `);
  });
});

describe('diffObjs', () => {
  it('should return no differences for identical objects', () => {
    const obj1 = { a: 1, b: 2, c: { d: 3 } };
    const obj2 = { a: 1, b: 2, c: { d: 3 } };
    const diff = jsondiffpatch.diff(obj1, obj2);
    expect(diff).toBeUndefined();
  });

  it('should return differences for different objects', () => {
    const obj1 =
    {
      "level1": {
        "level2": {
          "level3": {
            "level4": {
              "value1": "This is a deeply nested value",
              "value2": 42,
              "value3": [
                1,
                2,
                3,
                4,
                5
              ],
              "level5": {
                "value4": true,
                "value5": null
              }
            },
            "arrayLevel3": [
              {
                "item1": "Item 1"
              },
              {
                "item2": "Item 2"
              },
              {
                "item3": "Item 3"
              }
            ]
          },
          "anotherLevel3": {
            "value6": "Another value at level 3"
          }
        },
        "arrayLevel2": [
          {
            "itemA": "Item A"
          },
          {
            "itemB": "Item B"
          }
        ]
      },
      "topLevelValue": "This is a top level value"
    }
    const obj2 =
    {
      "level1": {
        "level2": {
          "level3": {
            "level4": {
              "value2": 43,
              "value3": [
                1,
                2,
                4,
                5
              ],
              "level5": {
                "value4": true,
                "value5": null
              }
            },
            "arrayLevel3": [
              {
                "item1": "Item 1"
              },
              {
                "item2": "Item 2"
              },
              {
                "item3": "Item 3"
              },
              {
                "item4": "Item 4"
              }
            ]
          },
          "anotherLevel3": {
            "value6": "Another value at level 3"
          }
        },
        "arrayLevel2": [
          {
            "itemA": "Item A"
          },
          {
            "itemB": "Item B"
          }
        ]
      }
    }
    const diff = jsondiffpatch.diff(obj1, obj2);
    expect(diff).toMatchInlineSnapshot(`
      {
        "level1": {
          "level2": {
            "level3": {
              "arrayLevel3": {
                "3": [
                  {
                    "item4": "Item 4",
                  },
                ],
                "_t": "a",
              },
              "level4": {
                "value1": [
                  "This is a deeply nested value",
                  0,
                  0,
                ],
                "value2": [
                  42,
                  43,
                ],
                "value3": {
                  "_2": [
                    3,
                    0,
                    0,
                  ],
                  "_t": "a",
                },
              },
            },
          },
        },
        "topLevelValue": [
          "This is a top level value",
          0,
          0,
        ],
      }
    `);

  });
});
