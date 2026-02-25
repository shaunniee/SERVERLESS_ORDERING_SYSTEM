/**
 * Typed error classes for the ordering system.
 *
 * Step Functions catch blocks use error names to route to compensation steps.
 * Each error includes a structured payload for logging and debugging.
 */

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    details?: Record<string, unknown>
  ) {
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
export class InventoryError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 409, "INVENTORY_ERROR", details);
  }
}

/**
 * Thrown when payment processing fails (card declined, gateway timeout).
 * Step Functions catches this to trigger CompensateInventory.
 */
export class PaymentError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 402, "PAYMENT_ERROR", details);
  }
}

/**
 * Thrown when order creation in DynamoDB fails.
 * Step Functions catches this to trigger RefundPayment + CompensateInventory.
 */
export class OrderError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 500, "ORDER_ERROR", details);
  }
}

/**
 * Thrown when input validation fails (bad request).
 * Step Functions catches this and returns immediately — no compensation needed.
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, "VALIDATION_ERROR", details);
  }
}

/**
 * Thrown when a user tries to access a resource they don't own.
 */
export class AuthorizationError extends AppError {
  constructor(message: string = "Forbidden") {
    super(message, 403, "AUTHORIZATION_ERROR");
  }
}

/**
 * Thrown when a requested resource doesn't exist.
 */
export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 404, "NOT_FOUND", { resource, id });
  }
}
