import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

const logger = new Logger({ serviceName: 'processPayment' });
const tracer = new Tracer({ serviceName: 'processPayment' });
const metrics = new Metrics({ namespace: 'OrderingSystem', serviceName: 'processPayment' });

const FAIL_PAYMENT_PERCENT = parseInt(process.env.FAIL_PAYMENT_PERCENT || '20', 10);

export const handler = async (event) => {
  const { orderId, userId, totalAmount } = event;
  logger.appendKeys({ orderId, userId });

  // Simulate payment processing with configurable failure rate
  const random = Math.random() * 100;

  if (random < FAIL_PAYMENT_PERCENT) {
    logger.warn('Payment failed (simulated)', { failPercent: FAIL_PAYMENT_PERCENT });
    metrics.addMetric('PaymentFailed', MetricUnit.Count, 1);
    metrics.publishStoredMetrics();
    throw new Error('Payment declined');
  }

  logger.info('Payment processed successfully', { totalAmount });
  metrics.addMetric('PaymentProcessed', MetricUnit.Count, 1);
  metrics.publishStoredMetrics();

  return { ...event, paymentStatus: 'SUCCEEDED' };
};
