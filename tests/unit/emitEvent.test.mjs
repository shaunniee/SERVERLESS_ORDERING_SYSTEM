import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const ebMock = mockClient(EventBridgeClient);

const { handler } = await import('../../backend/lambdas/orders/emitEvent/index.mjs');

const baseEvent = {
  orderId: 'order-001',
  userId: 'user-123',
  totalAmount: 59.98,
  items: [{ productId: 'PROD-001', qty: 2 }],
};

describe('emitEvent', () => {
  beforeEach(() => {
    ebMock.reset();
    ebMock.resolves({});
  });

  it('sends PutEventsCommand with correct shape', async () => {
    await handler(baseEvent);

    const calls = ebMock.commandCalls(PutEventsCommand);
    expect(calls).toHaveLength(1);

    const entry = calls[0].args[0].input.Entries[0];
    expect(entry.EventBusName).toBe('test-event-bus');
    expect(entry.Source).toBe('ordering-system');
    expect(entry.DetailType).toBe('OrderPlaced');
  });

  it('includes orderId, userId, totalAmount, itemCount in detail', async () => {
    await handler(baseEvent);

    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries[0];
    const detail = JSON.parse(entry.Detail);

    expect(detail.orderId).toBe('order-001');
    expect(detail.userId).toBe('user-123');
    expect(detail.totalAmount).toBe(59.98);
    expect(detail.itemCount).toBe(1);
    expect(detail.timestamp).toBeDefined();
  });

  it('returns the original event', async () => {
    const result = await handler(baseEvent);

    expect(result).toEqual(baseEvent);
  });

  it('throws on EventBridge failure', async () => {
    ebMock.on(PutEventsCommand).rejects(new Error('EB down'));

    await expect(handler(baseEvent)).rejects.toThrow('EB down');
  });
});
