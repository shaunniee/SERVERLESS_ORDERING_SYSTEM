const { Logger } = require("@aws-lambda-powertools/logger");

/**
 * Shared Logger instance.
 *
 * Each Lambda handler should call `logger.addContext(context)` in the handler
 * and optionally `logger.appendKeys({ orderId })` to enrich log entries.
 *
 * Powertools Logger automatically includes:
 * - correlationId (from X-Ray trace)
 * - coldStart flag
 * - functionName, functionVersion, memorySize
 * - JSON structured format
 */
const logger = new Logger({
  serviceName: process.env.SERVICE_NAME ?? "ordering-system",
  logLevel: process.env.LOG_LEVEL ?? "INFO",
  persistentLogAttributes: {
    environment: process.env.ENV ?? "dev",
  },
});

module.exports = { logger };
