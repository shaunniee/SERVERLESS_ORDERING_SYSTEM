import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);

const { handler } = await import('../../backend/lambdas/orders/getOrder/index.mjs');

const context = { functionName: 'test', awsRequestId: 'req-1' };

const sampleOrder = {
  orderId: 'order-001',
  userId: 'user-123',
  status: 'CONFIRMED',
  totalAmount: 59.98,
  items: [{ productId: 'PROD-001', qty: 2 }],
};

describe('getOrder', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('returns 200 with order data when found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: sampleOrder });

    const result = await handler(
      { pathParameters: { orderId: 'order-001' } },
      context
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.orderId).toBe('order-001');
    expect(body.status).toBe('CONFIRMED');
  });

  it('queries DynamoDB with correct table and key', async () => {
    ddbMock.on(GetCommand).resolves({ Item: sampleOrder });

    await handler({ pathParameters: { orderId: 'order-001' } }, context);

    const calls = ddbMock.commandCalls(GetCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.TableName).toBe('test-orders-table');
    expect(calls[0].args[0].input.Key).toEqual({ orderId: 'order-001' });
  });

  it('returns 404 when order not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const result = await handler(
      { pathParameters: { orderId: 'nonexistent' } },
      context
    );

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error).toContain('not found');
  });

  it('returns 400 when orderId path parameter is missing', async () => {
    const result = await handler({ pathParameters: {} }, context);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('orderId');
  });

  it('returns 400 when pathParameters is undefined', async () => {
    const result = await handler({}, context);
    expect(result.statusCode).toBe(400);
  });

  it('returns 500 on DynamoDB failure', async () => {
    ddbMock.on(GetCommand).rejects(new Error('DDB down'));

    const result = await handler(
      { pathParameters: { orderId: 'order-001' } },
      context
    );

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error).toContain('retrieve');
  });
});
