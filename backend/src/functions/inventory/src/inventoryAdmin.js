const {
  GetCommand,
  BatchWriteCommand,
  PutCommand,
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
 * Initialize or re‐shard inventory for a product using partition-key sharding.
 *
 * Strategy:
 * 1. Read existing META to find old shardCount (if any).
 * 2. Delete all existing shard items + META.
 * 3. Write new shard items with evenly distributed quantities.
 * 4. Write the META record with the new shardCount.
 *
 * Each shard gets its own partition key: PRODUCT#<productId>#SHARD#<n>
 * This distributes writes across DynamoDB's partition map.
 *
 * @param {{ productId: string, totalQuantity: number, shardCount: number }} input
 * @returns {Promise<{ productId: string, shardCount: number, qtyPerShard: number, remainder: number, updatedAt: string }>}
 */
async function initializeShards(input) {
  const { productId, totalQuantity, shardCount } = input;

  logger.info("Initializing inventory shards (partition-key sharding)", {
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

  // 3. Batch-write new shard items (each with its own PK)
  const putRequests = [];
  for (let i = 0; i < shardCount; i++) {
    const qty = i === 0 ? qtyPerShard + remainder : qtyPerShard;
    putRequests.push({
      PutRequest: {
        Item: {
          pk: shardPk(productId, i),
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

  // 4. Write META record
  await docClient.send(
    new PutCommand({
      TableName: TableNames.INVENTORY_SHARDS,
      Item: {
        pk: metaPk(productId),
        productId,
        shardCount,
        totalQuantity,
        updatedAt: now,
      },
    })
  );

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
 * Delete all existing shard items and META record for a product.
 * @param {string} productId
 */
async function deleteExistingShards(productId) {
  // Read META to learn current shard count
  const metaResult = await docClient.send(
    new GetCommand({
      TableName: TableNames.INVENTORY_SHARDS,
      Key: { pk: metaPk(productId) },
      ProjectionExpression: "shardCount",
    })
  );

  if (!metaResult.Item) {
    return; // no existing shards
  }

  const { shardCount } = metaResult.Item;

  // Build delete requests for all shard PKs + META
  const deleteRequests = [];
  for (let i = 0; i < shardCount; i++) {
    deleteRequests.push({
      DeleteRequest: {
        Key: { pk: shardPk(productId, i) },
      },
    });
  }
  deleteRequests.push({
    DeleteRequest: {
      Key: { pk: metaPk(productId) },
    },
  });

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
    count: shardCount,
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
 * Initializes or re-shards inventory for a product using partition-key sharding.
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
