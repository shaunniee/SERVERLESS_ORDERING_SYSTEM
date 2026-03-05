import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

const logger = new Logger({ serviceName: 'refundPayment' });
const tracer = new Tracer({ serviceName: 'refundPayment' });
const metrics = new Metrics({ namespace: 'OrderingSystem', serviceName: 'refundPayment' });

export const handler = async (event) => {
  const { orderId, userId, totalAmount } = event;
  logger.appendKeys({ orderId, userId });

  // In a real system, this would call a payment gateway refund API.
  // For this project, we log the refund action.
  logger.info('Payment refunded', { totalAmount });
  metrics.addMetric('PaymentRefunded', MetricUnit.Count, 1);
  metrics.publishStoredMetrics();

  return event;
};
