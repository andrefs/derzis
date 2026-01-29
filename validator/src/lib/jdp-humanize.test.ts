import { describe, expect, it } from 'vitest';
import { humanizeDelta } from './jdp-humanize';
import * as jsondiffpatch from 'jsondiffpatch';

describe('humanizeDelta', () => {
  it('should describe added properties', () => {
    const delta = {
      newProp: [42],
    } as jsondiffpatch.Delta;
    const result = humanizeDelta(delta);
    expect(result).toEqual(['Added "newProp" with value 42']);
  });

  it('should describe removed properties', () => {
    const delta = {
      oldProp: [42, 0, 0],
    } as jsondiffpatch.Delta;
    const result = humanizeDelta(delta);
    expect(result).toEqual(['Removed "oldProp" (was 42)']);
  });

  it('should describe changed properties', () => {
    const delta = {
      changedProp: [42, 43],
    } as jsondiffpatch.Delta;
    const result = humanizeDelta(delta);
    expect(result).toEqual(['Changed "changedProp" from 42 to 43']);
  });

  it('should handle nested objects', () => {
    const delta = {
      nested: {
        newProp: [42],
        oldProp: [43, 0, 0],
        changedProp: [44, 45],
      },
    } as jsondiffpatch.Delta;
    const result = humanizeDelta(delta);
    expect(result).toEqual([
      'Added "nested.newProp" with value 42',
      'Removed "nested.oldProp" (was 43)',
      'Changed "nested.changedProp" from 44 to 45',
    ]);
  });

  it('should handle arrays', () => {
    const delta = {
      arr: {
        _t: 'a',
        '0': [1, 2],
        '1': [3],
        '2': [4, 0, 0],
      },
    } as jsondiffpatch.Delta;
    const result = humanizeDelta(delta);
    expect(result).toEqual([
      'Changed "arr.0" from 1 to 2',
      'Added "arr.1" with value 3',
      'Removed "arr.2" (was 4)',
    ]);
  });

  it('should ignore _t metadata', () => {
    const delta = {
      _t: 'a',
      prop: [1, 2],
    } as jsondiffpatch.Delta;
    const result = humanizeDelta(delta);
    expect(result).toEqual(['Changed "prop" from 1 to 2']);
  });

  it('should return an empty array for no changes', () => {
    const delta = {};
    const result = humanizeDelta(delta);
    expect(result).toEqual([]);
  });

  it('should handle actual jsondiffpatch output', () => {
    const obj1 = { a: 1, b: { c: 2, d: 3 }, e: [1, 2, 3] };
    const obj2 = { a: 1, b: { c: 20, f: 4 }, e: [1, 3, 4], g: 'new' };
    const delta = jsondiffpatch.diff(obj1, obj2) as jsondiffpatch.Delta;
    const result = humanizeDelta(delta);
    expect(result).toMatchInlineSnapshot(`
      [
        "Changed "b.c" from 2 to 20",
        "Removed "b.d" (was 3)",
        "Added "b.f" with value 4",
        "Added "e.2" with value 4",
        "Removed "e._1" (was 2)",
        "Added "g" with value "new"",
      ]
    `);
  });
});
