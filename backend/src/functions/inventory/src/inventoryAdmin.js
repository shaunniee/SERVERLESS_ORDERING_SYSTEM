const {
  QueryCommand,
  BatchWriteCommand,
} = require("@aws-sdk/lib-dynamodb");
const {
  logger,
  tracer,
  docClient,
  TableNames,
  UpdateInventoryInputSchema,
  success,
  error,
} = require("@ordering-system/shared-layer");

// ─── Core Logic ──────────────────────────────────────────────────────────────

/**
 * Initialize or re‐shard inventory for a product.
 *
 * Strategy:
 * 1. Delete all existing shards for the product (if any).
 * 2. Create `shardCount` new shards with evenly distributed quantities.
 * 3. Remainder from integer division goes to shard 0.
 *
 * This is an admin operation — not in the order hot path.
 * Re-sharding while orders are in flight may cause reservation failures
 * (acceptable: the saga retries or rejects the order).
 *
 * @param {{ productId: string, totalQuantity: number, shardCount: number }} input
 * @returns {Promise<{ productId: string, shardCount: number, qtyPerShard: number, remainder: number, updatedAt: string }>}
 */
async function initializeShards(input) {
  const { productId, totalQuantity, shardCount } = input;

  logger.info("Initializing inventory shards", {
    productId,
    totalQuantity,
    shardCount,
  });

  // 1. Delete existing shards
  await deleteExistingShards(productId);

  // 2. Calculate distribution
  const qtyPerShard = Math.floor(totalQuantity / shardCount);
  const remainder = totalQuantity % shardCount;
  const now = new Date().toISOString();

  // 3. Batch-write new shards (BatchWriteItem supports up to 25 items)
  const putRequests = [];
  for (let i = 0; i < shardCount; i++) {
    const qty = i === 0 ? qtyPerShard + remainder : qtyPerShard;
    putRequests.push({
      PutRequest: {
        Item: {
          productId,
          shardId: i,
          availableQty: qty,
          reservedQty: 0,
          version: 1,
          updatedAt: now,
        },
      },
    });
  }

  // BatchWriteItem allows max 25 items per request — chunk if needed
  const chunks = chunkArray(putRequests, 25);
  for (const chunk of chunks) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TableNames.INVENTORY_SHARDS]: chunk,
        },
      })
    );
  }

  logger.info("Inventory shards initialized", {
    productId,
    shardCount,
    qtyPerShard,
    remainder,
  });

  return {
    productId,
    shardCount,
    qtyPerShard,
    remainder,
    updatedAt: now,
  };
}

/**
 * Delete all existing shards for a product.
 * @param {string} productId
 */
async function deleteExistingShards(productId) {
  // Query existing shard keys
  const result = await docClient.send(
    new QueryCommand({
      TableName: TableNames.INVENTORY_SHARDS,
      KeyConditionExpression: "productId = :pk",
      ExpressionAttributeValues: { ":pk": productId },
      ProjectionExpression: "productId, shardId",
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return; // no existing shards to delete
  }

  // Batch-delete existing shards
  const deleteRequests = result.Items.map((item) => ({
    DeleteRequest: {
      Key: { productId: item.productId, shardId: item.shardId },
    },
  }));

  const chunks = chunkArray(deleteRequests, 25);
  for (const chunk of chunks) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TableNames.INVENTORY_SHARDS]: chunk,
        },
      })
    );
  }

  logger.info("Deleted existing shards", {
    productId,
    count: result.Items.length,
  });
}

/**
 * Split an array into chunks of a given size.
 * @template T
 * @param {T[]} arr
 * @param {number} size
 * @returns {T[][]}
 */
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ─── Lambda Handler (API Gateway) ───────────────────────────────────────────

/**
 * InventoryAdmin Lambda
 *
 * REST: PUT /v1/admin/inventory
 * Body: { productId, totalQuantity, shardCount }
 *
 * Initializes or re-shards inventory for a product.
 * Admin-only (Cognito admin group required at API Gateway level).
 *
 * @param {import("aws-lambda").APIGatewayProxyEvent} event
 * @param {import("aws-lambda").Context} context
 * @returns {Promise<import("aws-lambda").APIGatewayProxyResult>}
 */
module.exports.handler = async (event, context) => {
  logger.addContext(context);
  tracer.getSegment();

  try {
    if (!event.body) {
      return success(
        { error: "VALIDATION_ERROR", message: "Request body is required" },
        400
      );
    }

    const body = JSON.parse(event.body);
    const input = UpdateInventoryInputSchema.parse(body);

    logger.appendKeys({ productId: input.productId });

    const result = await initializeShards(input);

    return success(result, 200);
  } catch (err) {
    return error(err);
  }
};

/**
 * Direct invocation variant for internal/programmatic use.
 *
 * @param {{ productId: string, totalQuantity: number, shardCount: number }} event
 * @param {import("aws-lambda").Context} context
 */
module.exports.directHandler = async (event, context) => {
  logger.addContext(context);
  tracer.getSegment();

  const input = UpdateInventoryInputSchema.parse(event);
  logger.appendKeys({ productId: input.productId });

  return initializeShards(input);
};
