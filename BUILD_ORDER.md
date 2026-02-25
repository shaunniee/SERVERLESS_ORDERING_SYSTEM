# Build Order: Serverless Ordering System

Step-by-step dependency-aware build sequence. Each step lists what it depends on and what it unblocks.

---

## Dependency Map

```
[1] Terraform Backend
 └──► [2] Cognito
 └──► [3] DynamoDB Tables
       ├──► [4] Lambda Layer (Powertools + shared utils)
       │     ├──► [5] Inventory Lambdas
       │     │     └──► [8] Step Functions Saga ◄── [7] Payment Lambdas
       │     │                                  ◄── [6] Order Lambdas
       │     ├──► [6] Order Lambdas
       │     ├──► [7] Payment Lambdas
       │     ├──► [9] Catalog Lambdas
       │     └──► [10] Admin Lambdas
       └──► [11] ReservationExpiry Lambda (needs Orders stream)
 └──► [12] SQS Queue + DLQ
       └──► [13] SQS Trigger Lambda ──► [8] (already built)
 └──► [14] SNS Topics
       └──► [15] NotifyUser Lambda
[8] Step Functions Saga
 └──► [16] AppSync API ◄── [9] Catalog Lambdas
 └──► [17] API Gateway REST ◄── [9] Catalog Lambdas
[16] + [17]
 └──► [18] WAF + Security Tightening
 └──► [19] CloudWatch Dashboards + Alarms
 └──► [20] Integration Tests
       └──► [21] Load / Concurrency Tests
```

---

## Build Steps

### Step 1: Terraform Backend + Provider
**Depends on:** nothing  
**Unblocks:** everything

```
Create:
  infrastructure/backend.tf        — S3 state bucket + DynamoDB lock table
  infrastructure/providers.tf      — AWS provider, region, default tags
  infrastructure/variables.tf      — env, project name, region
  infrastructure/environments/dev.tfvars
```

Verify: `terraform init` + `terraform plan` succeed.

---

### Step 2: Cognito User Pool
**Depends on:** Step 1  
**Unblocks:** API auth (Steps 16, 17)

```
Create:
  infrastructure/modules/cognito/main.tf
    - User Pool (email/password)
    - App Client
    - User Groups: "customer", "admin"
  infrastructure/modules/cognito/outputs.tf
    - user_pool_id, user_pool_arn, app_client_id
```

Verify: sign up a test user, get a JWT, decode it, confirm group claim.

---

### Step 3: DynamoDB Tables
**Depends on:** Step 1  
**Unblocks:** all Lambdas (Steps 4-11)

```
Create:
  infrastructure/modules/dynamodb/main.tf
    - Products       (PK: productId, GSI: CategoryIndex)
    - Categories     (PK: categoryId)
    - Orders         (PK: userId, SK: orderId, GSI: StatusIndex, Stream, TTL)
    - InventoryShards (PK: productId, SK: shardId)
    - Idempotency    (PK: id, TTL on expiration)  ← Powertools schema
    - SagaState      (PK: sagaId, TTL)
  infrastructure/modules/dynamodb/outputs.tf
    - table ARNs, stream ARN, table names
```

Verify: all tables active, GSIs active, stream enabled on Orders, TTL enabled.

---

### Step 4: Lambda Layer (Shared)
**Depends on:** Step 3 (needs table names as env vars)  
**Unblocks:** all Lambdas (Steps 5-11, 13, 15)

```
Create:
  src/layers/shared/
    package.json               — Powertools + Zod + AWS SDK v3
    tsconfig.json
    src/
      logger.ts                — Powertools Logger instance
      tracer.ts                — Powertools Tracer instance
      idempotency.ts           — DynamoDBPersistenceLayer config
      errors.ts                — InventoryError, PaymentError, OrderError
      schemas/                 — Zod validation schemas per operation

  infrastructure/modules/lambda/layer.tf
    - Lambda Layer from src/layers/shared/
```

Verify: layer publishes, can be attached to a test Lambda, imports work.

---

### Step 5: Inventory Lambdas
**Depends on:** Steps 3, 4  
**Unblocks:** Step 8 (saga)

```
Create:
  src/lambdas/reserve-inventory/
    handler.ts    — TransactWriteItems across shards; wrapped in makeIdempotent()
  src/lambdas/compensate-inventory/
    handler.ts    — Inverse TransactWriteItems; idempotent
  src/lambdas/get-inventory/
    handler.ts    — Query all shards for a product, sum availableQty
  src/lambdas/inventory-admin/
    handler.ts    — Create/redistribute shards for a product

  infrastructure/modules/lambda/inventory.tf
    - Lambda functions + scoped IAM roles
    - ReserveInventory role: dynamodb:UpdateItem on InventoryShards, 
      dynamodb:PutItem/GetItem/UpdateItem/DeleteItem on Idempotency,
      dynamodb:PutItem on Orders (reservation record)
```

Verify: seed inventory shards → invoke ReserveInventory → verify shard decremented → invoke Compensate → verify restored. Run twice to confirm idempotency.

---

### Step 6: Order Lambdas
**Depends on:** Steps 3, 4  
**Unblocks:** Step 8 (saga)

```
Create:
  src/lambdas/create-order/
    handler.ts    — Conditional PutItem; transitions RESERVED → CONFIRMED
  src/lambdas/delete-order/
    handler.ts    — Compensation: delete or mark FAILED

  infrastructure/modules/lambda/orders.tf
    - Lambda functions + IAM roles (dynamodb on Orders table only)
```

Verify: invoke CreateOrder with mock data → item in Orders table → invoke DeleteOrder → item removed/marked.

---

### Step 7: Payment Lambdas
**Depends on:** Steps 3, 4  
**Unblocks:** Step 8 (saga)

```
Create:
  src/lambdas/process-payment/
    handler.ts    — Stripe/PayPal call (mock for portfolio); timeout + circuit breaker
  src/lambdas/refund-payment/
    handler.ts    — Idempotent refund

  infrastructure/modules/lambda/payments.tf
    - Lambda functions + IAM roles
    - Secrets Manager secret for payment API key (can be a placeholder)
```

Verify: invoke ProcessPayment with mock → returns success. Invoke with simulated failure → throws PaymentError.

---

### Step 8: Step Functions Saga
**Depends on:** Steps 5, 6, 7 (all saga Lambdas)  
**Unblocks:** Steps 16, 17 (APIs)

```
Create:
  src/step-functions/order-saga.asl.json
    States:
      1. ValidateInput    (Pass/Lambda)
      2. ReserveInventory (Lambda, retry 2x, catch → END)
      3. ProcessPayment   (Lambda, retry 1x, timeout 60s, catch → CompensateInventory → END)
      4. CreateOrder      (Lambda, retry 2x, catch → RefundPayment → CompensateInventory → END)
      5. NotifyUser       (Lambda, retry 2x, catch → log + continue)
      6. Success          (Succeed)
    Compensation states:
      - CompensateInventory → CompensateInventory Lambda
      - RefundPayment → RefundPayment Lambda
      - PersistSagaFailure → write to SagaState + SNS

  infrastructure/modules/step_functions/main.tf
    - Express state machine
    - IAM role: invoke all saga Lambdas
    - CloudWatch Logs log group
```

Verify:
- Happy path: start execution → all steps succeed → order in DynamoDB
- Payment fail: inventory restored, no order
- Order fail: payment refunded, inventory restored
- View execution in Step Functions console (screenshot for portfolio)

---

### Step 9: Catalog Lambdas
**Depends on:** Steps 3, 4  
**Unblocks:** Steps 16, 17 (APIs need these for queries)

```
Create:
  src/lambdas/get-product/handler.ts
  src/lambdas/list-products/handler.ts     — paginated, CategoryIndex query
  src/lambdas/get-order/handler.ts         — auth-scoped (own orders or admin)
  src/lambdas/list-orders/handler.ts       — paginated
  src/lambdas/list-categories/handler.ts

  infrastructure/modules/lambda/catalog.tf
```

Verify: seed Products + Categories → invoke ListProducts with category filter + pagination → correct results.

---

### Step 10: Admin Lambdas
**Depends on:** Steps 3, 4  
**Unblocks:** Steps 16, 17

```
Create:
  src/lambdas/category-admin/handler.ts    — Create/update/soft-delete

  infrastructure/modules/lambda/admin.tf
```

Verify: create category → update name → soft delete → ListCategories excludes deleted.

---

### Step 11: Reservation Expiry Lambda
**Depends on:** Step 3 (Orders stream), Step 5 (CompensateInventory)  
**Unblocks:** nothing (safety net, runs async)

```
Create:
  src/lambdas/reservation-expiry/
    handler.ts    — DynamoDB Stream consumer; on REMOVE of RESERVED order → CompensateInventory

  infrastructure/modules/lambda/expiry.tf
    - Event source mapping: Orders stream → this Lambda
    - Filter: eventName = REMOVE AND status = RESERVED
```

Verify: insert a RESERVED order with expiresAt in the past → wait for TTL deletion → verify inventory shard restored.

---

### Step 12: SQS Queue + DLQ
**Depends on:** Step 1  
**Unblocks:** Step 13 (trigger Lambda)

```
Create:
  infrastructure/modules/sqs/main.tf
    - order-requests queue
    - order-requests-dlq (maxReceiveCount: 3)
    - Encryption at rest (SSE-SQS)
```

Verify: send a test message → visible in queue → consume it.

---

### Step 13: SQS Trigger Lambda
**Depends on:** Steps 8, 12  
**Unblocks:** Steps 16, 17 (API can now enqueue orders)

```
Create:
  src/lambdas/start-order-saga/
    handler.ts    — Reads SQS message → starts Step Functions execution (orderId as execution name for dedupe)

  infrastructure/modules/lambda/trigger.tf
    - Event source mapping: SQS → Lambda (batch size 1)
    - IAM: sqs:ReceiveMessage + states:StartExecution
```

Verify: send message to SQS → saga executes → order in DynamoDB.

---

### Step 14: SNS Topics
**Depends on:** Step 1  
**Unblocks:** Step 15

```
Create:
  infrastructure/modules/sns/main.tf
    - order-confirmed topic
    - order-failed topic
    - saga-failures topic (ops alerts)
```

---

### Step 15: NotifyUser Lambda
**Depends on:** Steps 4, 14  
**Unblocks:** nothing (already wired into saga at Step 8)

```
Create:
  src/lambdas/notify-user/
    handler.ts    — Publish to SNS topic based on order status

  infrastructure/modules/lambda/notifications.tf
```

Verify: invoke with mock order → message published to SNS topic.

---

### Step 16: AppSync API
**Depends on:** Steps 2, 8, 9, 10, 12, 13  
**Unblocks:** Step 18 (WAF)

```
Create:
  infrastructure/modules/appsync/main.tf
    - GraphQL schema
    - Lambda resolvers for each query/mutation
    - Cognito auth for mutations, API key for public queries
    - Subscription: onOrderStatusChange
  src/appsync/schema.graphql
```

Verify: run queries/mutations via AppSync console; test auth (customer can't access admin mutations).

---

### Step 17: API Gateway REST
**Depends on:** Steps 2, 9, 10, 12, 13  
**Unblocks:** Step 18 (WAF)

```
Create:
  infrastructure/modules/api_gateway/main.tf
    - REST API with /v1/* prefix
    - All endpoints from the plan
    - Cognito authorizer for protected routes
    - API Key for public routes
    - JSON Schema request validation
    - CORS configuration
    - Stage: dev
```

Verify: curl all endpoints; verify auth, validation, pagination, CORS headers.

---

### Step 18: WAF + Security Tightening
**Depends on:** Steps 16, 17  
**Unblocks:** nothing (hardening pass)

```
Create:
  infrastructure/modules/security/main.tf
    - WAF WebACL on API Gateway + AppSync
    - Rate limit rule (2000 req/5min per IP)
    - AWS managed rule sets

Audit:
  - Review all Lambda IAM roles — remove any * actions
  - Ensure all tables have SSE + PITR
  - Verify Secrets Manager for payment keys
```

---

### Step 19: CloudWatch Dashboards + Alarms
**Depends on:** Steps 8, 12, 16, 17 (needs deployed resources to monitor)  
**Unblocks:** nothing (observability pass)

```
Create:
  infrastructure/modules/monitoring/main.tf
    - Dashboard: orders/min, success %, compensation %, Lambda errors, DLQ depth
    - Alarms: Lambda errors >5%, DLQ >0, DynamoDB throttles >0, saga compensation >2%
    - X-Ray: enable on all Lambdas (POWERTOOLS_TRACER_CAPTURE_RESPONSE=true)
```

Verify: trigger an alarm intentionally → SNS notification received.

---

### Step 20: Integration Tests
**Depends on:** Steps 16 or 17 (needs a working API)  
**Unblocks:** Step 21

```
Create:
  tests/integration/
    order-happy-path.test.ts
    order-payment-failure.test.ts
    order-inventory-exhausted.test.ts
    order-idempotency.test.ts
    catalog-pagination.test.ts
    auth-access-control.test.ts
```

---

### Step 21: Load / Concurrency Tests
**Depends on:** Step 20  
**Unblocks:** nothing (final validation)

```
Create:
  tests/load/
    k6-concurrent-orders.js    — 50 threads, same SKU, verify 0 oversells
    k6-mixed-workload.js       — reads + writes at target throughput
```

Verify: zero oversells. Screenshot the k6 output for portfolio.

---

## Quick Reference: What Blocks What

| If this isn't done... | ...these are blocked |
|---|---|
| Terraform backend (1) | Everything |
| DynamoDB tables (3) | All Lambdas, saga, APIs |
| Lambda layer (4) | All Lambdas |
| Inventory Lambdas (5) | Saga (8) |
| Order Lambdas (6) | Saga (8) |
| Payment Lambdas (7) | Saga (8) |
| Step Functions (8) | APIs routing to order creation |
| SQS + trigger (12, 13) | Async order flow through APIs |
| Cognito (2) | Auth on APIs |

## What Can Be Built in Parallel

| Parallel Track A | Parallel Track B | Parallel Track C |
|---|---|---|
| Cognito (2) | DynamoDB tables (3) | SQS + DLQ (12) |
| — | Lambda Layer (4) | SNS topics (14) |
| — | Inventory Lambdas (5) | — |
| — | Order Lambdas (6) | — |
| — | Payment Lambdas (7) | — |
| Catalog Lambdas (9) | Step Functions (8) | Admin Lambdas (10) |
| AppSync (16) | API Gateway (17) | Monitoring (19) |
