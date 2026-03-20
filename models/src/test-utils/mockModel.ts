// MockModel utility for type-safe mocking of Mongoose models
// This utility helps avoid "as any" casts when mocking model methods in tests

import { vi } from 'vitest';
import type { Model } from 'mongoose';

/**
 * Creates a type-safe mock of a Mongoose model
 * @template T - The document type
 * @returns A mock object with common model methods typed appropriately
 */
export function createMockModel<T>() {
  const mock = {
    // Static methods
    find: vi.fn(),
    findOne: vi.fn(),
    findById: vi.fn(),
    countDocuments: vi.fn(),
    estimatedDocumentCount: vi.fn(),
    insertMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
    deleteOne: vi.fn(),
    updateMany: vi.fn(),
    updateOne: vi.fn(),
    replaceOne: vi.fn(),
    bulkWrite: vi.fn(),
    aggregate: vi.fn(),

    // Instance methods (when working with documents)
    save: vi.fn(),
    remove: vi.fn(),
    updateOne: vi.fn(),
    updateMany: vi.fn(),
    deleteOne: vi.fn(),

    // Chainable query methods (returning the mock for chaining)
    where: vi.fn().mockReturnThis(),
    equals: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    ne: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    nin: vi.fn().mockReturnThis(),
    regex: vi.fn().mockReturnThis(),
    options: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    lean: vi.fn().mockReturnThis(),
    exec: vi.fn(),

    // Additional utility methods
    populate: vi.fn().mockReturnThis()
  };

  return mock as unknown as Model<T>;
}
