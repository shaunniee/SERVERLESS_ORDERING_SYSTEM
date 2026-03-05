import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '/opt/nodejs/lib/dynamodb.mjs';

const logger = new Logger({ serviceName: 'reserveInventory' });
const tracer = new Tracer({ serviceName: 'reserveInventory' });
const metrics = new Metrics({ namespace: 'OrderingSystem', serviceName: 'reserveInventory' });

const INVENTORY_TABLE = process.env.INVENTORY_TABLE;

export const handler = async (event) => {
  const { orderId, items } = event;
  logger.appendKeys({ orderId });

  const reservedItems = [];

  for (const item of items) {
    const { productId, qty } = item;

    try {
      // Atomic decrement with condition: only succeeds if stock >= qty
      await docClient.send(
        new UpdateCommand({
          TableName: INVENTORY_TABLE,
          Key: { productId },
          UpdateExpression: 'SET stock = stock - :qty',
          ConditionExpression: 'attribute_exists(productId) AND stock >= :qty',
          ExpressionAttributeValues: { ':qty': qty },
        })
      );

      reservedItems.push({ productId, qty });
      logger.info('Inventory reserved', { productId, qty });
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        logger.warn('Insufficient stock', { productId, qty });

        // Roll back any items already reserved in this batch
        for (const reserved of reservedItems) {
          await docClient.send(
            new UpdateCommand({
              TableName: INVENTORY_TABLE,
              Key: { productId: reserved.productId },
              UpdateExpression: 'SET stock = stock + :qty',
              ExpressionAttributeValues: { ':qty': reserved.qty },
            })
          );
          logger.info('Rolled back reservation', { productId: reserved.productId });
        }

        throw new Error(`Insufficient stock for ${productId}`);
      }
      throw err;
    }
  }

  metrics.addMetric('InventoryReserved', MetricUnit.Count, 1);
  metrics.publishStoredMetrics();

  return { ...event, reservedItems };
};
