import { create, Delta } from 'jsondiffpatch';

/**
 * Convert a jsondiffpatch Delta into human-readable text.
 * @param delta The delta object produced by jsondiffpatch.diff()
 * @param path Internal recursive path tracker
 */
export function humanizeDelta(delta: Delta, path: (string | number)[] = []): string[] {
  const messages: string[] = [];

  for (const key in delta) {
    if (key === '_t') continue; // skip metadata (_t = "a" for arrays)

    const value = (delta as any)[key];
    const currentPath = [...path, key].join('.');

    // Case 1: Value changed
    if (Array.isArray(value) && value.length === 2) {
      const [oldVal, newVal] = value;
      messages.push(
        `Changed "${currentPath}" from ${JSON.stringify(oldVal)} to ${JSON.stringify(newVal)}`
      );
    }

    // Case 2: Value added
    else if (Array.isArray(value) && value.length === 1) {
      const [newVal] = value;
      messages.push(`Added "${currentPath}" with value ${JSON.stringify(newVal)}`);
    }

    // Case 3: Value deleted
    else if (Array.isArray(value) && value.length === 3 && value[1] === 0 && value[2] === 0) {
      const [oldVal] = value;
      messages.push(`Removed "${currentPath}" (was ${JSON.stringify(oldVal)})`);
    }

    // Case 4: Nested object or array
    else if (typeof value === 'object' && value !== null) {
      messages.push(...humanizeDelta(value as Delta, [...path, key]));
    }
  }

  return messages;
}
