const { TransactWriteCommand } = require("@aws-sdk/lib-dynamodb");
const { makeIdempotent } = require("@aws-lambda-powertools/idempotency");
const {
  logger,
  tracer,
  docClient,
  TableNames,
  persistenceStore,
  idempotencyConfig,
  CompensateInventoryInputSchema,
  InventoryError,
} = require("@ordering-system/shared-layer");

// ─── Core Handler ────────────────────────────────────────────────────────────

/**
 * CompensateInventory Lambda
 *
 * Called by the order saga on failure (Step Functions catch/compensation branch),
 * or by the ReservationExpiry Lambda for stale reservations.
 *
 * Reverses a previous reservation by atomically restoring availableQty and
 * reducing reservedQty on the exact shards that were reserved.
 *
 * Uses TransactWriteItems for atomicity. Idempotent via Lambda Powertools.
 *
 * @param {object} event
 * @returns {Promise<{ orderId: string, compensatedItems: Array, compensatedAt: string }>}
 */
const compensateInventory = async (event) => {
  const input = CompensateInventoryInputSchema.parse(event);
  const { orderId, items } = input;

  logger.appendKeys({ orderId });
  logger.info("Compensating inventory", { itemCount: items.length });

  const now = new Date().toISOString();

  // Build inverse TransactWriteItems — one Update per reserved item
  const transactItems = items.map((item) => ({
    Update: {
      TableName: TableNames.INVENTORY_SHARDS,
      Key: { productId: item.productId, shardId: Number(item.shardId) },
      UpdateExpression:
        "SET availableQty = availableQty + :qty, reservedQty = reservedQty - :qty, updatedAt = :now",
      ConditionExpression: "reservedQty >= :qty",
      ExpressionAttributeValues: {
        ":qty": item.quantity,
        ":now": now,
      },
    },
  }));

  try {
    await docClient.send(
      new TransactWriteCommand({ TransactItems: transactItems })
    );
  } catch (err) {
    if (err instanceof Error && err.name === "TransactionCanceledException") {
      // Compensation failed — this shouldn't happen under normal conditions.
      // Log as error for investigation; do not retry blindly.
      logger.error("Compensation transaction failed", {
        orderId,
        error: err.message,
      });

      throw new InventoryError(
        "Compensation failed — possible data inconsistency",
        { orderId }
      );
    }

    throw err;
  }

  logger.info("Inventory compensated successfully", {
    compensatedCount: items.length,
  });

  return {
    orderId,
    compensatedItems: items,
    compensatedAt: now,
  };
};

// ─── Idempotent + Instrumented Export ────────────────────────────────────────

module.exports.handler = makeIdempotent(
  async (event, context) => {
    logger.addContext(context);
    tracer.getSegment();

    return compensateInventory(event);
  },
  {
    persistenceStore,
    config: idempotencyConfig,
  }
);
