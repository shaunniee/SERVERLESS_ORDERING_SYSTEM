import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

// Mock the idempotency layer so makeIdempotent is a passthrough —
// avoids the internal DynamoDBClient that the persistence layer creates.
vi.mock('@aws-lambda-powertools/idempotency', () => ({
  makeIdempotent: (fn) => fn,
  IdempotencyConfig: class { constructor() {} },
}));
vi.mock('@aws-lambda-powertools/idempotency/dynamodb', () => ({
  DynamoDBPersistenceLayer: class { constructor() {} },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

const { handler } = await import('../../backend/lambdas/orders/createOrder/index.mjs');

const validBody = {
  userId: 'user-123',
  items: [{ productId: 'PROD-001', qty: 2 }],
  totalAmount: 59.98,
};

const makeEvent = (body) => ({
  body: JSON.stringify(body),
});

const context = { functionName: 'test', awsRequestId: 'req-1' };

describe('createOrder', () => {
  beforeEach(() => {
    ddbMock.reset();
    sqsMock.reset();
    ddbMock.resolves({});
    sqsMock.resolves({});
  });

  it('returns 201 with orderId on valid request', async () => {
    const result = await handler(makeEvent(validBody), context);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.orderId).toBeDefined();
    expect(body.status).toBe('PENDING');
  });

  it('writes order to DynamoDB with PENDING status', async () => {
    await handler(makeEvent(validBody), context);

    const putCalls = ddbMock.commandCalls(PutCommand);
    expect(putCalls.length).toBe(1);
    const putInput = putCalls[0].args[0].input;
    expect(putInput.TableName).toBe('test-orders-table');
    expect(putInput.Item.status).toBe('PENDING');
    expect(putInput.Item.userId).toBe('user-123');
    expect(putInput.ConditionExpression).toBe('attribute_not_exists(orderId)');
  });

  it('sends SQS message after DynamoDB write', async () => {
    await handler(makeEvent(validBody), context);

    const sqsCalls = sqsMock.commandCalls(SendMessageCommand);
    expect(sqsCalls.length).toBe(1);
    const msgBody = JSON.parse(sqsCalls[0].args[0].input.MessageBody);
    expect(msgBody.userId).toBe('user-123');
    expect(msgBody.items).toEqual([{ productId: 'PROD-001', qty: 2 }]);
  });

  it('returns 400 for missing userId', async () => {
    const result = await handler(makeEvent({ items: [{ productId: 'P1', qty: 1 }], totalAmount: 10 }), context);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('userId');
  });

  it('returns 400 for empty items array', async () => {
    const result = await handler(makeEvent({ userId: 'u1', items: [], totalAmount: 10 }), context);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('items');
  });

  it('returns 400 for invalid item (missing qty)', async () => {
    const result = await handler(makeEvent({ userId: 'u1', items: [{ productId: 'P1' }], totalAmount: 10 }), context);
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 for negative totalAmount', async () => {
    const result = await handler(makeEvent({ userId: 'u1', items: [{ productId: 'P1', qty: 1 }], totalAmount: -5 }), context);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('totalAmount');
  });

  it('returns 400 for invalid JSON body', async () => {
    const result = await handler({ body: 'not-json' }, context);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Invalid JSON');
  });

  it('returns 409 on duplicate orderId (ConditionalCheckFailedException)', async () => {
    const condError = new Error('Condition not met');
    condError.name = 'ConditionalCheckFailedException';
    ddbMock.on(PutCommand).rejects(condError);

    const result = await handler(makeEvent(validBody), context);
    expect(result.statusCode).toBe(409);
  });

  it('returns 500 on DynamoDB failure', async () => {
    ddbMock.on(PutCommand).rejects(new Error('DDB down'));

    const result = await handler(makeEvent(validBody), context);
    expect(result.statusCode).toBe(500);
  });

  it('returns 500 on SQS failure (order created but enqueue failed)', async () => {
    ddbMock.on(PutCommand).resolves({});
    sqsMock.on(SendMessageCommand).rejects(new Error('SQS down'));

    const result = await handler(makeEvent(validBody), context);
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error).toContain('enqueue');
  });
});
