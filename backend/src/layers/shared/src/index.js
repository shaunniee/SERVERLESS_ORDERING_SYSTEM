// =============================================================================
// Shared Layer — Barrel Export
// =============================================================================

// Powertools instances (pre-configured)
const { logger } = require("./logger");
const { tracer } = require("./tracer");
const { persistenceStore, idempotencyConfig } = require("./idempotency");

// DynamoDB client + table names
const { docClient, TableNames } = require("./dynamodb");

// Error types (used by Step Functions catches)
const {
  AppError,
  InventoryError,
  PaymentError,
  OrderError,
  ValidationError,
  AuthorizationError,
  NotFoundError,
} = require("./errors");

// Validation schemas
const {
  // Order
  CreateOrderInputSchema,
  OrderItemSchema,
  // Inventory
  ReserveInventoryInputSchema,
  CompensateInventoryInputSchema,
  UpdateInventoryInputSchema,
  // Category
  CreateCategoryInputSchema,
  UpdateCategoryInputSchema,
  // Product
  CreateProductInputSchema,
  UpdateProductInputSchema,
  ProductViewSchema,
  // Payment
  ProcessPaymentInputSchema,
  RefundPaymentInputSchema,
  // Pagination
  PaginationSchema,
} = require("./schemas");

// HTTP response helpers
const { success, error } = require("./response");

module.exports = {
  // Powertools
  logger,
  tracer,
  persistenceStore,
  idempotencyConfig,
  // DynamoDB
  docClient,
  TableNames,
  // Errors
  AppError,
  InventoryError,
  PaymentError,
  OrderError,
  ValidationError,
  AuthorizationError,
  NotFoundError,
  // Schemas
  CreateOrderInputSchema,
  OrderItemSchema,
  ReserveInventoryInputSchema,
  CompensateInventoryInputSchema,
  UpdateInventoryInputSchema,
  CreateCategoryInputSchema,
  UpdateCategoryInputSchema,
  CreateProductInputSchema,
  UpdateProductInputSchema,
  ProductViewSchema,
  ProcessPaymentInputSchema,
  RefundPaymentInputSchema,
  PaginationSchema,
  // Response helpers
  success,
  error,
};
