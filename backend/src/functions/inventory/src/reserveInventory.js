const {
  TransactWriteCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");
const { makeIdempotent } = require("@aws-lambda-powertools/idempotency");
const {
  logger,
  tracer,
  docClient,
  TableNames,
  persistenceStore,
  idempotencyConfig,
  ReserveInventoryInputSchema,
  InventoryError,
} = require("@ordering-system/shared-layer");

// ─── Constants ───────────────────────────────────────────────────────────────

const RESERVATION_TTL_SECONDS = 5 * 60; // 5 minutes

// ─── Shard Lookup ────────────────────────────────────────────────────────────

/**
 * Query all shards for a product and return them.
 * Shard count is small (1-20), so this is a lightweight query.
 *
 * @param {string} productId
 * @returns {Promise<Array<{ shardId: number, availableQty: number }>>}
 */
async function getShardsForProduct(productId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TableNames.INVENTORY_SHARDS,
      KeyConditionExpression: "productId = :pk",
      ExpressionAttributeValues: { ":pk": productId },
      ProjectionExpression: "shardId, availableQty",
    })
  );

  if (!result.Items || result.Items.length === 0) {
    throw new InventoryError(
      `No inventory shards found for product: ${productId}`,
      { productId }
    );
  }

  return result.Items;
}

/**
 * Pick a random shard that has enough stock. Falls back to any random shard
 * (the condition expression on the transaction will catch insufficient stock).
 *
 * @param {Array<{ shardId: number, availableQty: number }>} shards
 * @param {number} requiredQty
 * @returns {number}
 */
function pickShard(shards, requiredQty) {
  const viable = shards.filter((s) => s.availableQty >= requiredQty);
  const pool = viable.length > 0 ? viable : shards;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return chosen.shardId;
}

// ─── Core Handler ────────────────────────────────────────────────────────────

/**
 * ReserveInventory Lambda
 *
 * Called by the order saga (Step Functions). Reserves inventory for all items
 * in a cart using a single DynamoDB TransactWriteItems call (all-or-nothing).
 *
 * On success: returns the reserved items with their shard assignments.
 * On failure: throws InventoryError with details about which items failed.
 *
 * Idempotent via Lambda Powertools — safe to retry.
 *
 * @param {object} event
 * @returns {Promise<{ orderId: string, userId: string, reservedItems: Array, expiresAt: number }>}
 */
const reserveInventory = async (event) => {
  const input = ReserveInventoryInputSchema.parse(event);
  const { orderId, userId, items } = input;

  logger.appendKeys({ orderId, userId });
  logger.info("Reserving inventory", { itemCount: items.length });

  // 1. Look up shards for each unique product
  const uniqueProductIds = [...new Set(items.map((i) => i.productId))];
  const shardsByProduct = new Map();

  await Promise.all(
    uniqueProductIds.map(async (productId) => {
      const shards = await getShardsForProduct(productId);
      shardsByProduct.set(productId, shards);
    })
  );

  // 2. Assign a random shard per item
  const reservedItems = items.map((item) => {
    const shards = shardsByProduct.get(item.productId);
    const shardId = pickShard(shards, item.quantity);
    return { productId: item.productId, shardId, quantity: item.quantity };
  });

  // 3. Build TransactWriteItems — one Update per item
  const now = new Date().toISOString();
  const expiresAt = Math.floor(Date.now() / 1000) + RESERVATION_TTL_SECONDS;

  const transactItems = reservedItems.map((item) => ({
    Update: {
      TableName: TableNames.INVENTORY_SHARDS,
      Key: { productId: item.productId, shardId: item.shardId },
      UpdateExpression:
        "SET availableQty = availableQty - :qty, reservedQty = reservedQty + :qty, updatedAt = :now",
      ConditionExpression: "availableQty >= :qty",
      ExpressionAttributeValues: {
        ":qty": item.quantity,
        ":now": now,
      },
    },
  }));

  // 4. Execute transaction
  try {
    await docClient.send(
      new TransactWriteCommand({ TransactItems: transactItems })
    );
  } catch (err) {
    if (err instanceof Error && err.name === "TransactionCanceledException") {
      // Extract which items failed from cancellation reasons
      const failedItems = (err.CancellationReasons ?? [])
        .map((reason, idx) => {
          if (reason.Code === "ConditionalCheckFailed") {
            return {
              productId: reservedItems[idx].productId,
              requestedQty: reservedItems[idx].quantity,
              reason: "INSUFFICIENT_STOCK",
            };
          }
          return null;
        })
        .filter(Boolean);

      logger.warn("Inventory reservation failed — insufficient stock", {
        failedItems,
      });

      throw new InventoryError(
        "Insufficient inventory for one or more items",
        { failedItems }
      );
    }

    throw err; // re-throw unexpected errors
  }

  logger.info("Inventory reserved successfully", {
    reservedCount: reservedItems.length,
    expiresAt,
  });

  return {
    orderId,
    userId,
    reservedItems,
    expiresAt,
  };
};

// ─── Idempotent + Instrumented Export ────────────────────────────────────────

module.exports.handler = makeIdempotent(
  async (event, context) => {
    logger.addContext(context);
    tracer.getSegment();

    return reserveInventory(event);
  },
  {
    persistenceStore,
    config: idempotencyConfig,
  }
);
