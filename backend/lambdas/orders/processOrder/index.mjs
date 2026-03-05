import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { StartSyncExecutionCommand } from '@aws-sdk/client-sfn';
import { sfnClient } from '/opt/nodejs/lib/sfn.mjs';

const logger = new Logger({ serviceName: 'processOrder' });
const tracer = new Tracer({ serviceName: 'processOrder' });
const metrics = new Metrics({ namespace: 'OrderingSystem', serviceName: 'processOrder' });

const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN;

export const handler = async (event, context) => {
  logger.addContext(context);

  const batchItemFailures = [];

  for (const record of event.Records) {
    const { messageId } = record;

    try {
      const body = JSON.parse(record.body);
      const { orderId, userId, items, totalAmount } = body;

      logger.appendKeys({ orderId, userId, messageId });
      logger.info('Processing order from SQS');

      // Start Step Functions Express execution
      // Using orderId as the execution name provides built-in idempotency —
      // AWS rejects duplicate execution names within the deduplication window.
      await sfnClient.send(
        new StartSyncExecutionCommand({
          stateMachineArn: STATE_MACHINE_ARN,
          name: orderId,
          input: JSON.stringify({ orderId, userId, items, totalAmount }),
        })
      );

      logger.info('Saga execution completed');
      metrics.addMetric('OrderProcessed', MetricUnit.Count, 1);
    } catch (err) {
      logger.error('Failed to process order', { error: err.message, messageId });
      metrics.addMetric('OrderProcessingFailed', MetricUnit.Count, 1);

      // Report this message as failed so SQS retries only this one
      batchItemFailures.push({ itemIdentifier: messageId });
    }
  }

  metrics.publishStoredMetrics();

  // Partial batch failure reporting — successful messages are deleted,
  // failed ones return to the queue for retry.
  return { batchItemFailures };
};
