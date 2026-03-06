/**
 * Integration test — requires a deployed stack.
 * Set these env vars before running:
 *   API_URL       — API Gateway invoke URL (e.g. https://xxx.execute-api.eu-west-1.amazonaws.com/dev)
 *   AWS_REGION    — e.g. eu-west-1
 *   ORDERS_TABLE  — deployed Orders table name
 */
import { describe, it, expect } from 'vitest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const API_URL = process.env.API_URL;
const ORDERS_TABLE = process.env.ORDERS_TABLE;
const REGION = process.env.AWS_REGION || 'eu-west-1';

const ddbClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION })
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!API_URL)('Order Flow (integration)', () => {
  it('creates an order and processes it through the saga', async () => {
    // 1 — POST /orders
    const res = await fetch(`${API_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'integration-test-user',
        items: [{ productId: 'PROD-001', qty: 1 }],
        totalAmount: 29.99,
      }),
    });

    expect(res.status).toBe(201);
    const { orderId } = await res.json();
    expect(orderId).toBeDefined();

    // 2 — Wait for saga to complete (SQS → processOrder → Step Functions)
    //     Express executions are synchronous so it should be fast.
    await sleep(5000);

    // 3 — GET /orders/{orderId} should return CONFIRMED or FAILED
    const getRes = await fetch(`${API_URL}/orders/${orderId}`);
    expect(getRes.status).toBe(200);
    const order = await getRes.json();
    expect(order.orderId).toBe(orderId);
    expect(['CONFIRMED', 'FAILED']).toContain(order.status);

    // 4 — Verify directly in DynamoDB
    if (ORDERS_TABLE) {
      const { Item } = await ddbClient.send(
        new GetCommand({ TableName: ORDERS_TABLE, Key: { orderId } })
      );
      expect(Item).toBeDefined();
      expect(Item.status).toBe(order.status);
    }
  }, 30_000); // 30s timeout for end-to-end
});
