/**
 * Typed error classes for the ordering system.
 *
 * Step Functions catch blocks use error names to route to compensation steps.
 * Each error includes a structured payload for logging and debugging.
 */

class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   * @param {string} code
   * @param {Record<string, unknown>} [details]
   */
  constructor(message, statusCode, code, details) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Structured JSON for logging */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

/**
 * Thrown when inventory reservation fails (out of stock, shard contention).
 * Step Functions catches this to skip payment and return "out of stock".
 */
class InventoryError extends AppError {
  /**
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(message, details) {
    super(message, 409, "INVENTORY_ERROR", details);
  }
}

/**
 * Thrown when payment processing fails (card declined, gateway timeout).
 * Step Functions catches this to trigger CompensateInventory.
 */
class PaymentError extends AppError {
  /**
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(message, details) {
    super(message, 402, "PAYMENT_ERROR", details);
  }
}

/**
 * Thrown when order creation in DynamoDB fails.
 * Step Functions catches this to trigger RefundPayment + CompensateInventory.
 */
class OrderError extends AppError {
  /**
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(message, details) {
    super(message, 500, "ORDER_ERROR", details);
  }
}

/**
 * Thrown when input validation fails (bad request).
 * Step Functions catches this and returns immediately — no compensation needed.
 */
class ValidationError extends AppError {
  /**
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(message, details) {
    super(message, 400, "VALIDATION_ERROR", details);
  }
}

/**
 * Thrown when a user tries to access a resource they don't own.
 */
class AuthorizationError extends AppError {
  /**
   * @param {string} [message]
   */
  constructor(message = "Forbidden") {
    super(message, 403, "AUTHORIZATION_ERROR");
  }
}

/**
 * Thrown when a requested resource doesn't exist.
 */
class NotFoundError extends AppError {
  /**
   * @param {string} resource
   * @param {string} id
   */
  constructor(resource, id) {
    super(`${resource} not found: ${id}`, 404, "NOT_FOUND", { resource, id });
  }
}

module.exports = {
  AppError,
  InventoryError,
  PaymentError,
  OrderError,
  ValidationError,
  AuthorizationError,
  NotFoundError,
};
