import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);

const { handler } = await import('../../backend/lambdas/orders/confirmOrder/index.mjs');

const baseEvent = {
  orderId: 'order-001',
  userId: 'user-123',
  items: [{ productId: 'PROD-001', qty: 2 }],
  totalAmount: 59.98,
};

describe('confirmOrder', () => {
  beforeEach(() => {
    ddbMock.reset();
    ddbMock.resolves({});
  });

  it('updates order status to CONFIRMED', async () => {
    await handler(baseEvent);

    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(1);

    const input = calls[0].args[0].input;
    expect(input.TableName).toBe('test-orders-table');
    expect(input.Key).toEqual({ orderId: 'order-001' });
    expect(input.ExpressionAttributeValues[':status']).toBe('CONFIRMED');
  });

  it('returns event with status CONFIRMED', async () => {
    const result = await handler(baseEvent);

    expect(result.status).toBe('CONFIRMED');
    expect(result.orderId).toBe('order-001');
    expect(result.userId).toBe('user-123');
  });

  it('uses #status alias for reserved word', async () => {
    await handler(baseEvent);

    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.ExpressionAttributeNames['#status']).toBe('status');
  });

  it('throws on DynamoDB failure', async () => {
    ddbMock.on(UpdateCommand).rejects(new Error('DDB error'));

    await expect(handler(baseEvent)).rejects.toThrow('DDB error');
  });
});
