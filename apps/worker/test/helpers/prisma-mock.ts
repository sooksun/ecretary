/**
 * Minimal hand-rolled Prisma double.
 *
 * Only the delegates the job handlers actually touch are modelled. `$transaction`
 * invokes its callback with the same object, so a handler's `tx.*` calls land on
 * the same jest.fn()s as its direct `prisma.*` calls and assertions stay simple.
 */
export type PrismaMock = ReturnType<typeof createPrismaMock>;

export function createPrismaMock() {
  const mock = {
    audioChunk: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    meeting: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    transcriptSegment: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    meetingSummary: {
      upsert: jest.fn().mockResolvedValue({}),
    },
    actionItem: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    // Assigned below — declaring it here would make `mock` self-referential
    // and TypeScript cannot infer a type for that.
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation(async (fn: unknown) =>
    (fn as (tx: unknown) => Promise<unknown>)(mock),
  );
  return mock;
}

/** A BullMQ Queue stand-in exposing just `add`. */
export function createQueueMock() {
  return { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
}
