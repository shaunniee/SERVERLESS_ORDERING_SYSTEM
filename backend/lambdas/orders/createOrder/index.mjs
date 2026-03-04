import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { makeIdempotent, IdempotencyConfig } from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { docClient } from '/opt/nodejs/lib/dynamodb.mjs';
import { sqsClient } from '/opt/nodejs/lib/sqs.mjs';
import { success, error } from '/opt/nodejs/lib/response.mjs';

const logger = new Logger({ serviceName: 'createOrder' });
const tracer = new Tracer({ serviceName: 'createOrder' });
const metrics = new Metrics({ namespace: 'OrderingSystem', serviceName: 'createOrder' });

const ORDERS_TABLE = process.env.ORDERS_TABLE;
const ORDER_QUEUE_URL = process.env.ORDER_QUEUE_URL;
const IDEMPOTENCY_TABLE = process.env.IDEMPOTENCY_TABLE;

// ── Powertools Idempotency ──
// Uses a hash of the request body as the idempotency key.
// If the same payload arrives again within the expiry window (1 hour),
// Powertools returns the cached response without re-executing the handler.
const persistenceStore = new DynamoDBPersistenceLayer({ tableName: IDEMPOTENCY_TABLE });
const idempotencyConfig = new IdempotencyConfig({
  eventKeyJmesPath: 'body',         // hash the full request body
  expiresAfterSeconds: 3600,        // 1 hour TTL
});

const processOrder = async (event, context) => {
  logger.addContext(context);

  let body;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.warn('Invalid JSON in request body');
    return error(400, 'Invalid JSON in request body');
  }

  // ── Validate request ──
  const { userId, items, totalAmount } = body || {};

  if (!userId || typeof userId !== 'string') {
    return error(400, 'Missing or invalid userId');
  }
  if (!Array.isArray(items) || items.length === 0) {
    return error(400, 'items must be a non-empty array');
  }
  for (const item of items) {
    if (!item.productId || typeof item.qty !== 'number' || item.qty < 1) {
      return error(400, 'Each item must have a productId (string) and qty (integer >= 1)');
    }
  }
  if (typeof totalAmount !== 'number' || totalAmount <= 0) {
    return error(400, 'totalAmount must be a positive number');
  }

  // ── Generate order ──
  const orderId = crypto.randomUUID();
  const now = new Date().toISOString();

  const order = {
    orderId,
    userId,
    items,
    totalAmount,
    status: 'PENDING',
    failureReason: null,
    createdAt: now,
    updatedAt: now,
  };

  logger.appendKeys({ orderId, userId });

  // ── Write to DynamoDB ──
  try {
    await docClient.send(
      new PutCommand({
        TableName: ORDERS_TABLE,
        Item: order,
        ConditionExpression: 'attribute_not_exists(orderId)',
      })
    );
    logger.info('Order created in DynamoDB');
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      logger.warn('Duplicate orderId — already exists');
      return error(409, 'Order already exists');
    }
    logger.error('Failed to write order to DynamoDB', { error: err.message });
    return error(500, 'Failed to create order');
  }

  // ── Send message to SQS ──
  try {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: ORDER_QUEUE_URL,
        MessageBody: JSON.stringify({ orderId, userId, items, totalAmount }),
      })
    );
    logger.info('Order message sent to SQS');
  } catch (err) {
    logger.error('Failed to send message to SQS', { error: err.message });
    return error(500, 'Order created but failed to enqueue for processing');
  }

  // ── Emit metric ──
  metrics.addMetric('OrderCreated', MetricUnit.Count, 1);
  metrics.publishStoredMetrics();

  return success({ orderId, status: 'PENDING' }, 201);
};

// Wrap the handler with idempotency — duplicate requests return cached response
export const handler = makeIdempotent(processOrder, {
  persistenceStore,
  config: idempotencyConfig,
});
