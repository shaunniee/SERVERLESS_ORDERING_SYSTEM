const { z } = require("zod");

// ─── Order Schemas ───────────────────────────────────────────────────────────

const OrderItemSchema = z.object({
  productId: z.string().min(1, "productId is required"),
  quantity: z.number().int().positive("quantity must be a positive integer"),
});

const CreateOrderInputSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  orderId: z.string().min(1, "orderId is required"),
  idempotencyKey: z.string().min(1, "idempotencyKey is required"),
  items: z
    .array(OrderItemSchema)
    .min(1, "at least one item is required")
    .max(50, "maximum 50 items per order"),
});

// ─── Inventory Schemas ───────────────────────────────────────────────────────

const ReserveInventoryInputSchema = z.object({
  orderId: z.string().min(1),
  userId: z.string().min(1),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
      })
    )
    .min(1)
    .max(50),
});

const CompensateInventoryInputSchema = z.object({
  orderId: z.string().min(1),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        shardId: z.string().min(1),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
});

// ─── Inventory Admin Schemas ─────────────────────────────────────────────────

const UpdateInventoryInputSchema = z.object({
  productId: z.string().min(1),
  totalQuantity: z.number().int().nonnegative(),
  shardCount: z.number().int().min(1).max(20),
});

// ─── Category Schemas ────────────────────────────────────────────────────────

const CreateCategoryInputSchema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().optional(),
});

const UpdateCategoryInputSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  parentId: z.string().optional(),
});

// ─── Product Schemas ─────────────────────────────────────────────────────────

const CreateProductInputSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  price: z.number().positive(),
  categoryId: z.string().min(1),
  images: z.array(z.string().url()).max(10).optional(),
  metadata: z.record(z.string()).optional(),
});

const UpdateProductInputSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  price: z.number().positive().optional(),
  categoryId: z.string().min(1).optional(),
  images: z.array(z.string().url()).max(10).optional(),
  metadata: z.record(z.string()).optional(),
});

// ─── ProductView Schema (denormalized read model) ────────────────────────────

const ProductViewSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  categoryId: z.string().min(1),
  categoryName: z.string().min(1),
  images: z.array(z.string()).optional(),
  metadata: z.record(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ─── Payment Schemas ─────────────────────────────────────────────────────────

const ProcessPaymentInputSchema = z.object({
  orderId: z.string().min(1),
  userId: z.string().min(1),
  totalAmount: z.number().positive(),
  currency: z.string().length(3).default("EUR"),
  idempotencyKey: z.string().min(1),
});

const RefundPaymentInputSchema = z.object({
  orderId: z.string().min(1),
  paymentId: z.string().min(1),
  amount: z.number().positive(),
  idempotencyKey: z.string().min(1),
});

// ─── Pagination ──────────────────────────────────────────────────────────────

const PaginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  nextToken: z.string().optional(),
});

module.exports = {
  // Order
  OrderItemSchema,
  CreateOrderInputSchema,
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
};
