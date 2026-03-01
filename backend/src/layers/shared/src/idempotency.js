const {
  DynamoDBPersistenceLayer,
} = require("@aws-lambda-powertools/idempotency/dynamodb");
const {
  IdempotencyConfig,
} = require("@aws-lambda-powertools/idempotency");

/**
 * DynamoDB persistence layer for Lambda Powertools Idempotency.
 *
 * Table schema (created via Terraform):
 *   PK: id (String)
 *   TTL: expiration
 *
 * Usage in a handler:
 *   const { makeIdempotent } = require("@aws-lambda-powertools/idempotency");
 *   const { persistenceStore, idempotencyConfig } = require("@ordering-system/shared-layer");
 *
 *   const handler = async (event) => { ... };
 *   module.exports.handler = makeIdempotent(handler, {
 *     persistenceStore,
 *     config: idempotencyConfig,
 *   });
 */
const persistenceStore = new DynamoDBPersistenceLayer({
  tableName: process.env.IDEMPOTENCY_TABLE_NAME ?? "dev-idempotency",
});

const idempotencyConfig = new IdempotencyConfig({
  eventKeyJmesPath: "orderId", // deduplicate by orderId
  expiresAfterSeconds: 3600, // 1 hour TTL
  throwOnNoIdempotencyKey: true, // fail fast if key missing
});

module.exports = { persistenceStore, idempotencyConfig };
