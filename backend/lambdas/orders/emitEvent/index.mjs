import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { ebClient } from '/opt/nodejs/lib/eventbridge.mjs';

const logger = new Logger({ serviceName: 'emitEvent' });
const tracer = new Tracer({ serviceName: 'emitEvent' });
const metrics = new Metrics({ namespace: 'OrderingSystem', serviceName: 'emitEvent' });

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

export const handler = async (event) => {
  const { orderId, userId, totalAmount, items } = event;
  logger.appendKeys({ orderId });

  const detail = {
    orderId,
    userId,
    totalAmount,
    itemCount: items.length,
    timestamp: new Date().toISOString(),
  };

  await ebClient.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: EVENT_BUS_NAME,
          Source: 'ordering-system',
          DetailType: 'OrderPlaced',
          Detail: JSON.stringify(detail),
        },
      ],
    })
  );

  logger.info('OrderPlaced event emitted', { detail });
  metrics.addMetric('OrderPlacedEventEmitted', MetricUnit.Count, 1);
  metrics.publishStoredMetrics();

  return event;
};
