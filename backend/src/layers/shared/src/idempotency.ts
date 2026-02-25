import { DynamoDBPersistenceLayer } from "@aws-lambda-powertools/idempotency/dynamodb";
import { IdempotencyConfig } from "@aws-lambda-powertools/idempotency";

/**
 * DynamoDB persistence layer for Lambda Powertools Idempotency.
 *
 * Table schema (created via Terraform):
 *   PK: id (String)
 *   TTL: expiration
 *
 * Usage in a handler:
 *   import { makeIdempotent } from "@aws-lambda-powertools/idempotency";
 *   import { persistenceStore, idempotencyConfig } from "@ordering-system/shared-layer";
 *
 *   const handler = async (event) => { ... };
 *   export const lambdaHandler = makeIdempotent(handler, {
 *     persistenceStore,
 *     config: idempotencyConfig,
 *   });
 */
export const persistenceStore = new DynamoDBPersistenceLayer({
  tableName: process.env.IDEMPOTENCY_TABLE_NAME ?? "dev-idempotency",
});

export const idempotencyConfig = new IdempotencyConfig({
  eventKeyJmesPath: "orderId",          // deduplicate by orderId
  expiresAfterSeconds: 3600,            // 1 hour TTL
  throwOnNoIdempotencyKey: true,        // fail fast if key missing
});
