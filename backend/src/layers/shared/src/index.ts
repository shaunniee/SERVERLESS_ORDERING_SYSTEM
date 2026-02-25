// =============================================================================
// Shared Layer — Barrel Export
// =============================================================================

// Powertools instances (pre-configured)
export { logger } from "./logger";
export { tracer } from "./tracer";
export { persistenceStore, idempotencyConfig } from "./idempotency";

// DynamoDB client + table names
export { docClient, TableNames } from "./dynamodb";

// Error types (used by Step Functions catches)
export {
  AppError,
  InventoryError,
  PaymentError,
  OrderError,
  ValidationError,
  AuthorizationError,
  NotFoundError,
} from "./errors";

// Validation schemas + types
export {
  // Order
  CreateOrderInputSchema,
  OrderItemSchema,
  type CreateOrderInput,
  type OrderItem,
  // Inventory
  ReserveInventoryInputSchema,
  CompensateInventoryInputSchema,
  UpdateInventoryInputSchema,
  type ReserveInventoryInput,
  type CompensateInventoryInput,
  type UpdateInventoryInput,
  // Category
  CreateCategoryInputSchema,
  UpdateCategoryInputSchema,
  type CreateCategoryInput,
  type UpdateCategoryInput,
  // Payment
  ProcessPaymentInputSchema,
  RefundPaymentInputSchema,
  type ProcessPaymentInput,
  type RefundPaymentInput,
  // Pagination
  PaginationSchema,
  type PaginationInput,
} from "./schemas";

// HTTP response helpers
export { success, error } from "./response";
