const { GetCommand, BatchGetCommand } = require("@aws-sdk/lib-dynamodb");
const {
  logger,
  tracer,
  docClient,
  TableNames,
  NotFoundError,
  success,
  error,
} = require("@ordering-system/shared-layer");

// ─── Partition Key Helpers ───────────────────────────────────────────────────

/**
 * @param {string} productId
 * @param {number} shardId
 * @returns {string}
 */
function shardPk(productId, shardId) {
  return `PRODUCT#${productId}#SHARD#${shardId}`;
}

/**
 * @param {string} productId
 * @returns {string}
 */
function metaPk(productId) {
  return `PRODUCT#${productId}#META`;
}

// ─── Core Logic ──────────────────────────────────────────────────────────────

/**
 * Get aggregated inventory for a product using partition-key sharding.
 *
 * 1. GetItem the META record to learn shardCount.
 * 2. BatchGetItem all shard PKs.
 * 3. Sum availableQty and reservedQty.
 *
 * @param {string} productId
 * @returns {Promise<{ productId: string, totalAvailable: number, totalReserved: number, shardCount: number }>}
 */
async function getInventorySummary(productId) {
  // 1. Read metadata
  const metaResult = await docClient.send(
    new GetCommand({
      TableName: TableNames.INVENTORY_SHARDS,
      Key: { pk: metaPk(productId) },
      ProjectionExpression: "shardCount",
    })
  );

  if (!metaResult.Item) {
    throw new NotFoundError("Inventory", productId);
  }

  const { shardCount } = metaResult.Item;

  // 2. BatchGetItem all shard partition keys
  const keys = [];
  for (let i = 0; i < shardCount; i++) {
    keys.push({ pk: shardPk(productId, i) });
  }

  const batchResult = await docClient.send(
    new BatchGetCommand({
      RequestItems: {
        [TableNames.INVENTORY_SHARDS]: {
          Keys: keys,
          ProjectionExpression: "availableQty, reservedQty",
        },
      },
    })
  );

  const items =
    batchResult.Responses?.[TableNames.INVENTORY_SHARDS] ?? [];

  let totalAvailable = 0;
  let totalReserved = 0;

  for (const item of items) {
    totalAvailable += item.availableQty ?? 0;
    totalReserved += item.reservedQty ?? 0;
  }

  return {
    productId,
    totalAvailable,
    totalReserved,
    shardCount,
  };
}

// ─── Lambda Handler ──────────────────────────────────────────────────────────

/**
 * GetInventory Lambda
 *
 * REST: GET /v1/inventory/{productId}
 * GraphQL: getInventory(productId)
 *
 * Uses partition-key sharding: reads META for shard count, then BatchGetItem
 * across all shard PKs and sums the quantities.
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
 *
 * @param {{ productId: string }} event
 * @param {import("aws-lambda").Context} context
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
