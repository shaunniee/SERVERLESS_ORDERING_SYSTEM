import { z } from "zod";

// ─── Order Schemas ───────────────────────────────────────────────────────────

export const OrderItemSchema = z.object({
  productId: z.string().min(1, "productId is required"),
  quantity: z.number().int().positive("quantity must be a positive integer"),
});

export const CreateOrderInputSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  orderId: z.string().min(1, "orderId is required"),
  idempotencyKey: z.string().min(1, "idempotencyKey is required"),
  items: z
    .array(OrderItemSchema)
    .min(1, "at least one item is required")
    .max(50, "maximum 50 items per order"),
});

export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;

// ─── Inventory Schemas ───────────────────────────────────────────────────────

export const ReserveInventoryInputSchema = z.object({
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

export type ReserveInventoryInput = z.infer<typeof ReserveInventoryInputSchema>;

export const CompensateInventoryInputSchema = z.object({
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

export type CompensateInventoryInput = z.infer<typeof CompensateInventoryInputSchema>;

// ─── Inventory Admin Schemas ─────────────────────────────────────────────────

export const UpdateInventoryInputSchema = z.object({
  productId: z.string().min(1),
  totalQuantity: z.number().int().nonnegative(),
  shardCount: z.number().int().min(1).max(20),
});

export type UpdateInventoryInput = z.infer<typeof UpdateInventoryInputSchema>;

// ─── Category Schemas ────────────────────────────────────────────────────────

export const CreateCategoryInputSchema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().optional(),
});

export type CreateCategoryInput = z.infer<typeof CreateCategoryInputSchema>;

export const UpdateCategoryInputSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  parentId: z.string().optional(),
});

export type UpdateCategoryInput = z.infer<typeof UpdateCategoryInputSchema>;

// ─── Payment Schemas ─────────────────────────────────────────────────────────

export const ProcessPaymentInputSchema = z.object({
  orderId: z.string().min(1),
  userId: z.string().min(1),
  totalAmount: z.number().positive(),
  currency: z.string().length(3).default("EUR"),
  idempotencyKey: z.string().min(1),
});

export type ProcessPaymentInput = z.infer<typeof ProcessPaymentInputSchema>;

export const RefundPaymentInputSchema = z.object({
  orderId: z.string().min(1),
  paymentId: z.string().min(1),
  amount: z.number().positive(),
  idempotencyKey: z.string().min(1),
});

export type RefundPaymentInput = z.infer<typeof RefundPaymentInputSchema>;

// ─── Pagination ──────────────────────────────────────────────────────────────

export const PaginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  nextToken: z.string().optional(),
});

export type PaginationInput = z.infer<typeof PaginationSchema>;
