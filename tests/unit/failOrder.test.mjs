import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);

const { handler } = await import('../../backend/lambdas/orders/failOrder/index.mjs');

describe('failOrder', () => {
  beforeEach(() => {
    ddbMock.reset();
    ddbMock.resolves({});
  });

  it('updates order status to FAILED with error Cause', async () => {
    const event = {
      orderId: 'order-001',
      error: { Cause: 'Insufficient stock for PROD-001' },
    };

    await handler(event);

    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(1);

    const input = calls[0].args[0].input;
    expect(input.TableName).toBe('test-orders-table');
    expect(input.Key).toEqual({ orderId: 'order-001' });
    expect(input.ExpressionAttributeValues[':status']).toBe('FAILED');
    expect(input.ExpressionAttributeValues[':reason']).toBe('Insufficient stock for PROD-001');
  });

  it('returns event with status FAILED and failureReason', async () => {
    const event = {
      orderId: 'order-001',
      error: { Cause: 'Payment declined' },
    };

    const result = await handler(event);

    expect(result.status).toBe('FAILED');
    expect(result.failureReason).toBe('Payment declined');
    expect(result.orderId).toBe('order-001');
  });

  it('falls back to error.Error if Cause is missing', async () => {
    const event = {
      orderId: 'order-002',
      error: { Error: 'SomeError' },
    };

    const result = await handler(event);

    expect(result.failureReason).toBe('SomeError');
    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.ExpressionAttributeValues[':reason']).toBe('SomeError');
  });

  it('uses "Unknown error" when error object is missing', async () => {
    const event = { orderId: 'order-003' };

    const result = await handler(event);

    expect(result.failureReason).toBe('Unknown error');
  });

  it('throws on DynamoDB failure', async () => {
    ddbMock.on(UpdateCommand).rejects(new Error('DDB down'));

    await expect(handler({ orderId: 'order-004' })).rejects.toThrow('DDB down');
  });
});
