import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '/opt/nodejs/lib/dynamodb.mjs';

const logger = new Logger({ serviceName: 'confirmOrder' });
const tracer = new Tracer({ serviceName: 'confirmOrder' });
const metrics = new Metrics({ namespace: 'OrderingSystem', serviceName: 'confirmOrder' });

const ORDERS_TABLE = process.env.ORDERS_TABLE;

export const handler = async (event) => {
  const { orderId } = event;
  logger.appendKeys({ orderId });

  await docClient.send(
    new UpdateCommand({
      TableName: ORDERS_TABLE,
      Key: { orderId },
      UpdateExpression: 'SET #status = :status, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'CONFIRMED',
        ':now': new Date().toISOString(),
      },
    })
  );

  logger.info('Order confirmed');
  metrics.addMetric('OrderConfirmed', MetricUnit.Count, 1);
  metrics.publishStoredMetrics();

  return { ...event, status: 'CONFIRMED' };
};
