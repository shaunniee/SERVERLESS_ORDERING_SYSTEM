import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { sqsClient } from '/opt/nodejs/lib/sqs.mjs';
import { success, error } from '/opt/nodejs/lib/response.mjs';

const logger = new Logger({ serviceName: 'replayDlq' });
const tracer = new Tracer({ serviceName: 'replayDlq' });
const metrics = new Metrics({ namespace: 'OrderingSystem', serviceName: 'replayDlq' });

const DLQ_URL = process.env.DLQ_URL;
const ORDER_QUEUE_URL = process.env.ORDER_QUEUE_URL;
const MAX_MESSAGES = 10; // SQS max per receive call

export const handler = async (event, context) => {
  logger.addContext(context);

  let replayed = 0;
  let failed = 0;

  // Drain the DLQ in batches
  let keepPolling = true;

  while (keepPolling) {
    const { Messages = [] } = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: DLQ_URL,
        MaxNumberOfMessages: MAX_MESSAGES,
        WaitTimeSeconds: 1,
      })
    );

    if (Messages.length === 0) {
      keepPolling = false;
      break;
    }

    for (const msg of Messages) {
      try {
        // Re-send to the main queue
        await sqsClient.send(
          new SendMessageCommand({
            QueueUrl: ORDER_QUEUE_URL,
            MessageBody: msg.Body,
          })
        );

        // Delete from DLQ after successful re-send
        await sqsClient.send(
          new DeleteMessageCommand({
            QueueUrl: DLQ_URL,
            ReceiptHandle: msg.ReceiptHandle,
          })
        );

        replayed++;
      } catch (err) {
        logger.error('Failed to replay message', {
          error: err.message,
          messageId: msg.MessageId,
        });
        failed++;
      }
    }

    // Safety: stop after processing a reasonable number of messages
    // to avoid Lambda timeout on very large DLQs
    if (replayed + failed >= 100) {
      logger.warn('Reached replay limit of 100 messages, stopping');
      keepPolling = false;
    }
  }

  logger.info('DLQ replay complete', { replayed, failed });
  metrics.addMetric('DlqMessagesReplayed', MetricUnit.Count, replayed);
  metrics.addMetric('DlqReplayFailed', MetricUnit.Count, failed);
  metrics.publishStoredMetrics();

  return success({ replayed, failed });
};
