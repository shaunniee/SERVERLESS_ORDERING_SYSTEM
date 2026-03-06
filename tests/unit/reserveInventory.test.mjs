import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);

const { handler } = await import('../../backend/lambdas/orders/reserveInventory/index.mjs');

const baseEvent = {
  orderId: 'order-001',
  items: [
    { productId: 'PROD-001', qty: 2 },
    { productId: 'PROD-002', qty: 1 },
  ],
};

describe('reserveInventory', () => {
  beforeEach(() => {
    ddbMock.reset();
    ddbMock.resolves({});
  });

  it('reserves all items and returns reservedItems', async () => {
    const result = await handler(baseEvent);

    expect(result.reservedItems).toEqual([
      { productId: 'PROD-001', qty: 2 },
      { productId: 'PROD-002', qty: 1 },
    ]);
    expect(result.orderId).toBe('order-001');
  });

  it('sends UpdateCommand for each item with atomic decrement', async () => {
    await handler(baseEvent);

    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(2);

    const first = calls[0].args[0].input;
    expect(first.TableName).toBe('test-inventory-table');
    expect(first.Key).toEqual({ productId: 'PROD-001' });
    expect(first.UpdateExpression).toBe('SET stock = stock - :qty');
    expect(first.ConditionExpression).toContain('stock >= :qty');
    expect(first.ExpressionAttributeValues[':qty']).toBe(2);
  });

  it('rolls back reserved items on insufficient stock', async () => {
    // First item succeeds, second fails with ConditionalCheckFailedException
    const condError = new Error('Condition not met');
    condError.name = 'ConditionalCheckFailedException';

    ddbMock
      .on(UpdateCommand, { Key: { productId: 'PROD-001' } }).resolves({})
      .on(UpdateCommand, { Key: { productId: 'PROD-002' } }).rejects(condError);

    await expect(handler(baseEvent)).rejects.toThrow('Insufficient stock for PROD-002');

    // Should have 3 calls total: reserve PROD-001, attempt PROD-002, rollback PROD-001
    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls.length).toBe(3);

    // 3rd call should be the rollback (stock + qty)
    const rollback = calls[2].args[0].input;
    expect(rollback.Key).toEqual({ productId: 'PROD-001' });
    expect(rollback.UpdateExpression).toBe('SET stock = stock + :qty');
    expect(rollback.ExpressionAttributeValues[':qty']).toBe(2);
  });

  it('throws on unexpected DynamoDB errors', async () => {
    ddbMock.on(UpdateCommand).rejects(new Error('Service unavailable'));

    await expect(handler(baseEvent)).rejects.toThrow('Service unavailable');
  });

  it('handles single-item reservation', async () => {
    const result = await handler({ orderId: 'order-002', items: [{ productId: 'PROD-001', qty: 5 }] });

    expect(result.reservedItems).toEqual([{ productId: 'PROD-001', qty: 5 }]);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
  });
});
