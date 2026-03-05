import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '/opt/nodejs/lib/dynamodb.mjs';

const logger = new Logger({ serviceName: 'releaseInventory' });
const tracer = new Tracer({ serviceName: 'releaseInventory' });
const metrics = new Metrics({ namespace: 'OrderingSystem', serviceName: 'releaseInventory' });

const INVENTORY_TABLE = process.env.INVENTORY_TABLE;

export const handler = async (event) => {
  const { orderId, items } = event;
  logger.appendKeys({ orderId });

  for (const item of items) {
    const { productId, qty } = item;

    await docClient.send(
      new UpdateCommand({
        TableName: INVENTORY_TABLE,
        Key: { productId },
        UpdateExpression: 'SET stock = stock + :qty',
        ExpressionAttributeValues: { ':qty': qty },
      })
    );

    logger.info('Inventory released', { productId, qty });
  }

  metrics.addMetric('InventoryReleased', MetricUnit.Count, 1);
  metrics.publishStoredMetrics();

  return event;
};
