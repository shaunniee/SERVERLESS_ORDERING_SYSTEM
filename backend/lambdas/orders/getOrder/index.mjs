import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '/opt/nodejs/lib/dynamodb.mjs';
import { success, error } from '/opt/nodejs/lib/response.mjs';

const logger = new Logger({ serviceName: 'getOrder' });
const tracer = new Tracer({ serviceName: 'getOrder' });

const ORDERS_TABLE = process.env.ORDERS_TABLE;

export const handler = async (event, context) => {
  logger.addContext(context);

  const orderId = event.pathParameters?.orderId;

  if (!orderId) {
    return error(400, 'Missing orderId path parameter');
  }

  logger.appendKeys({ orderId });

  try {
    const { Item } = await docClient.send(
      new GetCommand({
        TableName: ORDERS_TABLE,
        Key: { orderId },
      })
    );

    if (!Item) {
      logger.info('Order not found');
      return error(404, 'Order not found');
    }

    logger.info('Order retrieved');
    return success(Item);
  } catch (err) {
    logger.error('Failed to get order', { error: err.message });
    return error(500, 'Failed to retrieve order');
  }
};
