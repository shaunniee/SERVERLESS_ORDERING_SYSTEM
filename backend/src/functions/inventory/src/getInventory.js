const { QueryCommand } = require("@aws-sdk/lib-dynamodb");
const {
  logger,
  tracer,
  docClient,
  TableNames,
  NotFoundError,
  success,
  error,
} = require("@ordering-system/shared-layer");

// ─── Core Logic ──────────────────────────────────────────────────────────────

/**
 * Query all shards for a product and sum the quantities.
 *
 * @param {string} productId
 * @returns {Promise<{ productId: string, totalAvailable: number, totalReserved: number, shardCount: number }>}
 */
async function getInventorySummary(productId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TableNames.INVENTORY_SHARDS,
      KeyConditionExpression: "productId = :pk",
      ExpressionAttributeValues: { ":pk": productId },
      ProjectionExpression: "shardId, availableQty, reservedQty",
    })
  );

  if (!result.Items || result.Items.length === 0) {
    throw new NotFoundError("Inventory", productId);
  }

  let totalAvailable = 0;
  let totalReserved = 0;

  for (const item of result.Items) {
    totalAvailable += item.availableQty ?? 0;
    totalReserved += item.reservedQty ?? 0;
  }

  return {
    productId,
    totalAvailable,
    totalReserved,
    shardCount: result.Items.length,
  };
}

// ─── Lambda Handler ──────────────────────────────────────────────────────────

/**
 * GetInventory Lambda
 *
 * REST: GET /v1/inventory/{productId}
 * GraphQL: getInventory(productId)
 *
 * Queries all inventory shards for a product and returns aggregated totals.
 * This is a read-only operation — no idempotency needed.
 *
 * @param {import("aws-lambda").APIGatewayProxyEvent} event
 * @param {import("aws-lambda").Context} context
 * @returns {Promise<import("aws-lambda").APIGatewayProxyResult>}
 */
module.exports.handler = async (event, context) => {
  logger.addContext(context);
  tracer.getSegment();

  try {
    const productId = event.pathParameters?.productId;

    if (!productId) {
      return success(
        { error: "VALIDATION_ERROR", message: "productId is required" },
        400
      );
    }

    logger.appendKeys({ productId });
    logger.info("Getting inventory for product");

    const summary = await getInventorySummary(productId);

    return success(summary);
  } catch (err) {
    return error(err);
  }
};

/**
 * Direct invocation variant for Step Functions / internal calls.
 * Accepts a plain object instead of API Gateway event.
 *
 * @param {{ productId: string }} event
 * @param {import("aws-lambda").Context} context
 * @returns {Promise<{ productId: string, totalAvailable: number, totalReserved: number, shardCount: number }>}
 */
module.exports.directHandler = async (event, context) => {
  logger.addContext(context);
  tracer.getSegment();

  if (!event.productId) {
    throw new Error("productId is required");
  }

  logger.appendKeys({ productId: event.productId });
  return getInventorySummary(event.productId);
};
