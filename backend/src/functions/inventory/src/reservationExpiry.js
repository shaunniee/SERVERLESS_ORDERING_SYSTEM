const { TransactWriteCommand } = require("@aws-sdk/lib-dynamodb");
const {
  logger,
  tracer,
  docClient,
  TableNames,
  InventoryError,
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

// ─── Core Logic ──────────────────────────────────────────────────────────────

/**
 * Compensate inventory for a single expired reservation.
 * Restores availableQty and reduces reservedQty atomically.
 * Uses partition-key sharding: key is PRODUCT#<productId>#SHARD#<shardId>.
 *
 * @param {{ orderId: string, userId: string, items: Array<{ productId: string, shardId: number, quantity: number }> }} order
 */
async function compensateExpiredReservation(order) {
  const { orderId, items } = order;
  const now = new Date().toISOString();

  logger.info("Compensating expired reservation", {
    orderId,
    itemCount: items.length,
  });

  const transactItems = items.map((item) => ({
    Update: {
      TableName: TableNames.INVENTORY_SHARDS,
      Key: { pk: shardPk(item.productId, item.shardId) },
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
    logger.info("Expired reservation compensated", { orderId });
  } catch (err) {
    if (err instanceof Error && err.name === "TransactionCanceledException") {
      // Already compensated (idempotent) or data inconsistency
      logger.warn(
        "Compensation transaction cancelled — may already be compensated",
        { orderId, error: err.message }
      );
      return;
    }

    throw err;
  }
}

// ─── Lambda Handler ──────────────────────────────────────────────────────────

/**
 * ReservationExpiry Lambda
 *
 * Triggered by DynamoDB Streams on the Orders table.
 *
 * Flow:
 * 1. DynamoDB TTL deletes expired RESERVED orders.
 * 2. The stream emits a REMOVE event with the old image.
 * 3. This Lambda detects REMOVE events for RESERVED orders.
 * 4. Calls compensateExpiredReservation to restore inventory.
 *
 * This is the safety net for reservations abandoned by crashed sagas.
 * The compensation is idempotent — safe if the saga already completed.
 *
 * @param {import("aws-lambda").DynamoDBStreamEvent} event
 * @param {import("aws-lambda").Context} context
 */
module.exports.handler = async (event, context) => {
  logger.addContext(context);
  tracer.getSegment();

  logger.info("Processing DynamoDB stream batch", {
    recordCount: event.Records.length,
  });

  /** @type {Array<{ orderId: string, userId: string, items: Array<{ productId: string, shardId: number, quantity: number }> }>} */
  const expiredOrders = [];

  for (const record of event.Records) {
    // Only process TTL-triggered removals of RESERVED orders
    if (record.eventName !== "REMOVE") continue;

    const oldImage = record.dynamodb?.OldImage;
    if (!oldImage) continue;

    // Check if the removed order was in RESERVED status
    const status = oldImage.status?.S;
    if (status !== "RESERVED") continue;

    // Check if this was a TTL deletion
    const isSystemDelete =
      record.userIdentity && record.userIdentity.type === "Service";

    if (!isSystemDelete) {
      logger.debug("Skipping non-TTL removal", {
        orderId: oldImage.orderId?.S,
      });
      continue;
    }

    const orderId = oldImage.orderId?.S;
    const userId = oldImage.userId?.S;

    if (!orderId || !userId) {
      logger.warn("Expired order missing orderId or userId", { oldImage });
      continue;
    }

    // Parse reserved items from the old image
    const reservedItemsList = oldImage.reservedItems?.L;
    if (!reservedItemsList || reservedItemsList.length === 0) {
      logger.warn("Expired order has no reservedItems", { orderId });
      continue;
    }

    const items = reservedItemsList
      .map((item) => {
        const m = item.M;
        if (!m) return null;
        return {
          productId: m.productId?.S ?? "",
          shardId: Number(m.shardId?.N ?? 0),
          quantity: Number(m.quantity?.N ?? 0),
        };
      })
      .filter(
        (item) => item !== null && item.productId !== "" && item.quantity > 0
      );

    if (items.length > 0) {
      expiredOrders.push({ orderId, userId, items });
    }
  }

  if (expiredOrders.length === 0) {
    logger.info("No expired RESERVED orders in this batch");
    return;
  }

  logger.info("Found expired reservations to compensate", {
    count: expiredOrders.length,
  });

  // Process each expired order
  const results = await Promise.allSettled(
    expiredOrders.map((order) => compensateExpiredReservation(order))
  );

  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    logger.error("Some compensation operations failed", {
      total: expiredOrders.length,
      failed: failures.length,
      errors: failures.map((f) =>
        f.status === "rejected" ? f.reason?.message : ""
      ),
    });

    // Throw to trigger DynamoDB Streams retry for the entire batch
    throw new InventoryError(
      `${failures.length}/${expiredOrders.length} compensation operations failed`,
      { failedOrderIds: expiredOrders.map((o) => o.orderId) }
    );
  }

  logger.info("All expired reservations compensated successfully", {
    count: expiredOrders.length,
  });
};
