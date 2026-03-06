// Set env vars before any Lambda module loads
process.env.ORDERS_TABLE = 'test-orders-table';
process.env.INVENTORY_TABLE = 'test-inventory-table';
process.env.IDEMPOTENCY_TABLE = 'test-idempotency-table';
process.env.ORDER_QUEUE_URL = 'https://sqs.eu-west-1.amazonaws.com/123456789012/test-queue';
process.env.STATE_MACHINE_ARN = 'arn:aws:states:eu-west-1:123456789012:stateMachine:test-saga';
process.env.EVENT_BUS_NAME = 'test-event-bus';
process.env.FAIL_PAYMENT_PERCENT = '0';
process.env.POWERTOOLS_SERVICE_NAME = 'test';
process.env.POWERTOOLS_METRICS_NAMESPACE = 'TestOrderingSystem';
process.env.POWERTOOLS_LOG_LEVEL = 'SILENT';
process.env.POWERTOOLS_DEV = 'true';
process.env._X_AMZN_TRACE_ID = 'Root=1-fake-trace-id';
