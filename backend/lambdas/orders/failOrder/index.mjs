import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '/opt/nodejs/lib/dynamodb.mjs';

const logger = new Logger({ serviceName: 'failOrder' });
const tracer = new Tracer({ serviceName: 'failOrder' });
const metrics = new Metrics({ namespace: 'OrderingSystem', serviceName: 'failOrder' });

const ORDERS_TABLE = process.env.ORDERS_TABLE;

export const handler = async (event) => {
  const { orderId } = event;
  // The error cause comes from the Catch block's ResultPath
  const failureReason = event.error?.Cause || event.error?.Error || 'Unknown error';
  logger.appendKeys({ orderId });

  await docClient.send(
    new UpdateCommand({
      TableName: ORDERS_TABLE,
      Key: { orderId },
      UpdateExpression: 'SET #status = :status, failureReason = :reason, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'FAILED',
        ':reason': failureReason,
        ':now': new Date().toISOString(),
      },
    })
  );

  logger.info('Order failed', { failureReason });
  metrics.addMetric('OrderFailed', MetricUnit.Count, 1);
  metrics.publishStoredMetrics();

  return { ...event, status: 'FAILED', failureReason };
};
