# Implementation Plan: High-Throughput Serverless Ordering System (DynamoDB-Only)

Comprehensive build plan with design-review updates applied and Redis removed.

> **Scope note:** This is a portfolio/demonstration project. The goal is to showcase
> architectural design, distributed-systems thinking, and IaC skills — not to
> operate a production service. Single AWS account, single environment (`dev`),
> and minimal running cost are priorities. Production-grade items (multi-account,
> HA, 24/7 monitoring) are documented as "would-do" callouts rather than
> implemented.

---

## 1) Architecture Decisions (Updated)

| ID | Decision | Choice |
|---|---|---|
| ADR-01 | IaC | Terraform modules with remote state (S3 + DynamoDB lock table) |
| ADR-02 | Inventory consistency | DynamoDB conditional writes + transactions (no Redis) |
| ADR-03 | Scale strategy | Inventory sharding in DynamoDB (`productId` + `shardId`) |
| ADR-04 | Workflow | Step Functions Express for order saga |
| ADR-05 | API strategy | AppSync (GraphQL) + API Gateway REST `/v1/*` |
| ADR-06 | Security baseline | WAF, least-privilege IAM, KMS/Secrets Manager, encryption everywhere |
| ADR-07 | Idempotency | Lambda Powertools `makeIdempotent` + DynamoDB persistence layer |
| ADR-08 | Event buffering | SQS queue in front of saga starts |
| ADR-09 | Order lifecycle | `PENDING -> RESERVED -> PAYMENT_PROCESSING -> CONFIRMED -> SHIPPED -> DELIVERED/CANCELLED/FAILED` |
| ADR-10 | Observability | Lambda Powertools Logger + Tracer (replaces custom logger and manual X-Ray) |
| ADR-11 | Lambda runtime | Node.js 20.x + **AWS Lambda Powertools for TypeScript** |
| ADR-12 | Reservation atomicity | `TransactWriteItems` for full cart — all-or-nothing; no partial reservations |
| ADR-13 | Reservation expiry | Orders table `expiresAt` + DynamoDB TTL + Stream triggers compensation Lambda |
| ADR-14 | Rollback strategy | Lambda alias blue/green; Terraform state-based infra rollback |

---

## 2) Target Data Model (DynamoDB)

### 2.1 Tables

1. **Products**
   - PK: `productId`
   - Attributes: `name`, `description`, `price`, `categoryId`, `images`, `metadata`, timestamps
   - GSI: `CategoryIndex(categoryId)`

2. **Categories**
   - PK: `categoryId`
   - Attributes: `name`, `parentId`, `deleted`, timestamps

3. **Orders**
   - PK: `userId`, SK: `orderId`
   - Attributes: status, items, totals, payment fields, timestamps, `expiresAt`
   - GSI: `StatusIndex(statusMonth, createdAt)` where `statusMonth = "STATUS#YYYY-MM"`
   - Stream: enabled (`NEW_AND_OLD_IMAGES`)

4. **InventoryShards** *(partition-key sharding)*
   - PK: `pk` = `PRODUCT#<productId>#SHARD#<n>` — each shard in its own DynamoDB partition for maximum write throughput
   - Metadata item: PK = `PRODUCT#<productId>#META` — stores `shardCount`, `productId`
   - Shard item attributes: `productId`, `shardId`, `availableQty`, `reservedQty`, `version`, `updatedAt`
   - No sort key — all lookups are `GetItem` / `BatchGetItem` by exact PK
   - Reads: `GetItem` the META record to learn `shardCount`, then `BatchGetItem` all shard PKs

5. **Idempotency** *(schema managed by Lambda Powertools)*
   - PK: `id` (Powertools default key name)
   - Attributes: `data`, `status`, `expiration`, `in_progress_expiration`, `validation`
   - TTL: enabled on `expiration`
   - Note: Terraform creates the table; Powertools manages the item schema automatically

6. **SagaState**
   - PK: `sagaId`
   - Attributes: current step, failure reason, compensation status, payload
   - TTL: enabled

7. **ProductViews** *(denormalized read model — CQRS)*
   - PK: `productId`
   - Attributes: `name`, `description`, `price`, `categoryId`, `categoryName`, `images`, `metadata`, `createdAt`, `updatedAt`
   - GSI: `categoryIndex(categoryId, createdAt)` — paginated listing by category
   - Built synchronously during `CreateProduct` / `UpdateProduct` — the Lambda writes to both `Products` (source of truth) and `ProductViews` (read model) in parallel
   - When a category is renamed, a fan-out Lambda updates all affected `ProductView` items to keep `categoryName` consistent

### 2.2 Inventory Reservation Algorithm

Reservation uses **`TransactWriteItems`** for atomicity across cart items:

1. For each item in the cart, pick a random shard for that product.
2. Build a single `TransactWriteItems` request containing one `Update` per item:
   - `UpdateExpression`: `SET availableQty = availableQty - :qty, reservedQty = reservedQty + :qty`
   - `ConditionExpression`: `availableQty >= :qty`
3. Submit the transaction:
   - **Success →** all items reserved atomically.
   - **`TransactionCanceledException` →** none are reserved; whole cart rejected. Return which item(s) failed via cancellation reasons.
4. On compensation: inverse `TransactWriteItems` restores all quantities atomically.
5. Limit: DynamoDB transactions support up to **100 items** per request (sufficient for any realistic cart).

This prevents overselling and avoids partial-reservation states without Redis.

### 2.3 Reservation Expiry

If the saga crashes between `ReserveInventory` and `CreateOrder`, reserved stock must be freed:

1. `ReserveInventory` writes a reservation record in the **Orders** table with status `RESERVED` and `expiresAt = now + 5 min`.
2. DynamoDB TTL auto-deletes expired reservation records.
3. The Orders **DynamoDB Stream** captures the TTL deletion (`eventName: REMOVE`).
4. A **`ReservationExpiry`** Lambda attached to the stream detects removed `RESERVED` orders and calls `CompensateInventory` to restore shard quantities.
5. The compensation is idempotent — safe to run even if the saga already completed.

This guarantees no inventory is permanently locked by abandoned sagas.

---

## 3) Build Order (Phased)

## Phase 0: Repo, Terraform Foundation + CI Scaffold (Day 1)

- Finalize Terraform layout under `infrastructure/modules/*`
- Configure provider, backend, and remote state lock table
- Add lint/security checks: `terraform fmt`, `validate`, `tflint`, `checkov`
- **Set up basic GitHub Actions CI pipeline now** (lint → validate → plan). Expand it incrementally in later phases so every change from Phase 1 onward deploys through CI.

**Exit criteria:** `terraform init/plan` clean in dev workspace; CI pipeline runs on push.

## Phase 1: Auth (Days 1-2)

- **No VPC needed** — all services (DynamoDB, Lambda, AppSync, API Gateway, SQS, SNS, Step Functions) are fully managed and accessed over HTTPS. This is a major simplification from the Redis design.
- Deploy Cognito user pool, app clients, groups (`customer`, `admin`)
- Apply **baseline IAM scoping from Day 1**: each Lambda role is scoped to its specific tables/actions. Phase 7 is a tightening pass, not the first pass.

> **Production would-do:** Add VPC if Redis/RDS is added later; add custom domain + hosted UI.

**Exit criteria:** JWTs issued with role/group claims; IAM role templates ready.

## Phase 2: DynamoDB Core (Days 2-4)

- Create `Products`, `Categories`, `Orders`, `InventoryShards`, `Idempotency`, `SagaState`
- Enable PITR and SSE on all tables
- Enable TTL where specified
- Enable Orders stream for downstream reactions

**Exit criteria:** tables + GSIs active, stream enabled, basic CRUD smoke-tested.

## Phase 3: Order Lambdas (Days 4-8)

Split into sub-phases to keep each batch testable:

### Phase 3a — Shared Layer + Inventory (Days 4-5)
- **Shared Lambda Layer** (Node.js 20.x):
  - **AWS Lambda Powertools for TypeScript:**
    - `@aws-lambda-powertools/logger` — structured JSON logs, auto-injects correlation ID, cold-start flag, X-Ray trace ID
    - `@aws-lambda-powertools/tracer` — auto-instruments AWS SDK calls, adds custom annotations/subsegments
    - `@aws-lambda-powertools/idempotency` — `makeIdempotent()` wrapper + `DynamoDBPersistenceLayer`; replaces all custom idempotency code
  - AWS SDK v3 DynamoDB client
  - Input validation (Zod schemas)
  - Typed error classes (`InventoryError`, `PaymentError`, `OrderError`)
  - Note: Powertools **replaces** custom logger, custom tracer, and custom idempotency guard — zero custom code for those concerns
- `ReserveInventory` — `TransactWriteItems` across shards; idempotent
- `CompensateInventory` — inverse transaction; idempotent
- `GetInventory` — query + sum shards
- `InventoryAdmin` — re-shard/split workflow
- `ReservationExpiry` — DynamoDB Stream consumer; releases stale reservations

### Phase 3b — Orders + Payments (Days 5-6)
- `CreateOrder` — conditional PutItem; idempotent via `orderId`
- `DeleteOrder` — compensation path
- `ProcessPayment` — Stripe/PayPal call with timeout + circuit breaker check
- `RefundPayment` — idempotent refund

### Phase 3c — Catalog + Admin (Days 7-8)
- `GetProduct`, `ListProducts` (paginated via CategoryIndex)
- `GetOrder`, `ListOrders` (paginated; auth-scoped)
- `ListCategories`
- `CategoryAdmin` (CRUD; soft delete)
- `NotifyUser` (SNS publish)

Each Lambda gets a **scoped IAM role** from day one (e.g., `ReserveInventory` can only `dynamodb:UpdateItem` on `InventoryShards` and `dynamodb:PutItem/GetItem/UpdateItem/DeleteItem` on `Idempotency` — Powertools needs these for its persistence layer).

**Exit criteria:** all Lambdas pass unit tests and invoke successfully.

## Phase 4: Saga Orchestration (Days 7-9)

- Create SQS `order-requests` + DLQ
- Create trigger Lambda that starts Step Functions execution
- Build Express state machine:
  1. ValidateInput
  2. ReserveInventory
  3. ProcessPayment
  4. CreateOrder
  5. NotifyUser
  6. Compensation branches on any failure
- Add bounded retries, timeouts, and catch handlers
- Persist compensation failures to `SagaState` and send SNS alert

**Exit criteria:** happy path + compensation paths verified.

## Phase 5: API Layer (Days 10-13)

### 5.1 AppSync GraphQL Schema

```graphql
type Product {
  productId: ID!
  name: String!
  description: String
  price: Float!
  categoryId: ID!
  categoryName: String
  images: [String]
  availableQuantity: Int
  createdAt: AWSDateTime!
}

type Category {
  categoryId: ID!
  name: String!
  parentId: ID
}

type Order {
  orderId: ID!
  userId: ID!
  status: OrderStatus!
  items: [OrderItem!]!
  totalAmount: Float!
  paymentId: String
  createdAt: AWSDateTime!
  updatedAt: AWSDateTime!
}

type OrderItem {
  productId: ID!
  productName: String!
  quantity: Int!
  unitPrice: Float!
}

enum OrderStatus {
  PENDING
  RESERVED
  PAYMENT_PROCESSING
  CONFIRMED
  SHIPPED
  DELIVERED
  CANCELLED
  FAILED
}

type ProductConnection {
  items: [Product!]!
  nextToken: String
}

type OrderConnection {
  items: [Order!]!
  nextToken: String
}

input CreateOrderInput {
  items: [OrderItemInput!]!
  idempotencyKey: String!
}

input OrderItemInput {
  productId: ID!
  quantity: Int!
}

type Mutation {
  createOrder(input: CreateOrderInput!): Order!
  updateInventory(productId: ID!, totalQuantity: Int!, shardCount: Int!): Boolean
  createCategory(name: String!, parentId: ID): Category!
  updateCategory(categoryId: ID!, name: String): Category!
  deleteCategory(categoryId: ID!): Boolean
}

type Query {
  getProduct(productId: ID!): Product
  listProducts(categoryId: ID, limit: Int, nextToken: String): ProductConnection!
  getOrder(orderId: ID!): Order
  listOrders(limit: Int, nextToken: String): OrderConnection!
  listCategories: [Category!]!
  getInventory(productId: ID!): Int
}

type Subscription {
  onOrderStatusChange(userId: ID!): Order
    @aws_subscribe(mutations: ["createOrder"])
}
```

Resolvers map to the same Lambdas as REST (shared business logic).

### 5.2 API Gateway REST Endpoints

| Endpoint | Method | Auth | Lambda |
|---|---|---|---|
| `/v1/orders` | POST | Cognito | → SQS (async) |
| `/v1/orders/{orderId}` | GET | Cognito | GetOrder |
| `/v1/orders` | GET | Cognito | ListOrders |
| `/v1/products/{productId}` | GET | API Key | GetProduct |
| `/v1/products` | GET | API Key | ListProducts |
| `/v1/inventory/{productId}` | GET | API Key | GetInventory |
| `/v1/categories` | GET | API Key | ListCategories |
| `/v1/admin/inventory` | PUT | Cognito (admin) | InventoryAdmin |
| `/v1/admin/categories` | POST/PUT/DELETE | Cognito (admin) | CategoryAdmin |

- Request validation via JSON Schema models
- CORS enabled (allowed origins: `localhost:3000` for portfolio demo)

**Exit criteria:** parity between GraphQL and REST flows; pagination works.

## Phase 6: Notifications + Events (Day 13-14)

- SNS topics: order success/failure, ops alerts
- Integrate `NotifyUser` to SNS/AppSync subscriptions

**Exit criteria:** customer + ops notifications delivered.

## Phase 7: Security Tightening Pass (Days 14-15)

IAM least-privilege was applied from Phase 3 onward. This phase is a **review and tightening pass**:

- Audit all IAM roles — remove any `*` actions added during development
- WAF on API Gateway/AppSync (rate limiting + managed rule sets)
- Secrets Manager for payment gateway API keys
- API throttling and usage plans
- Input validation audit across all endpoints

> **Production would-do:** AWS Config compliance rules, GuardDuty, VPC Flow Logs.

**Exit criteria:** `checkov` scan clean; no over-permissive IAM roles.

## Phase 8: Observability (Days 15-16)

- CloudWatch dashboards:
  - orders/min, success %, compensation %, p95/p99 latency
  - Lambda error/throttle/duration
  - SQS queue and DLQ depth
  - DynamoDB throttles and consumed capacity
- Key alarms (SNS):
  - Lambda error rate > 5%
  - SQS DLQ depth > 0
  - Saga compensation rate > 2%
  - DynamoDB throttled requests > 0
- X-Ray tracing (100% sampling for portfolio; 5% in real prod)

> **Production would-do:** PagerDuty/Opsgenie integration, business KPI dashboards, log retention policies.

**Exit criteria:** alarms test-fired and X-Ray trace map shows full saga flow.

## Phase 9: Testing + Load Validation (Days 16-18)

- Unit tests (>80% for critical order path)
- Integration tests for success/failure/idempotency/auth
- Concurrency tests focused on same-SKU contention
- Load tests (k6 or Artillery) — even a small run demonstrates the design holds:
  - 50 concurrent orders for the same SKU → verify zero oversells
  - Payment failure scenario → verify compensation completes
  - Duplicate submission → verify idempotent response

> **Portfolio tip:** Recording a short screen-capture or k6 summary output showing zero oversells under concurrency is a powerful portfolio artifact.

**Exit criteria:** no overselling under concurrency; compensation paths verified under load.

## Phase 10: CI/CD Finalization (Days 18-19)

The basic CI pipeline was created in Phase 0. Now finalize it:

- GitHub Actions workflow:
  - `on: push` → lint, validate, `checkov`, unit tests
  - `on: push to main` → `terraform plan` → `terraform apply` (auto for `dev`)
  - Lambda packaging and deploy step
  - Integration test gate
- Lambda deployment uses **alias-based blue/green**: publish new version → shift alias → instant rollback by re-pointing alias if broken.
- Terraform rollback: revert commit → CI re-applies previous state.

> **Portfolio scope:** Single `dev` environment is sufficient. Document a `dev → staging → prod` promotion flow in the README as a design decision without implementing multi-account.

**Exit criteria:** push-to-main triggers full deploy; rollback demonstrated.

---

## 4) Acceptance Criteria (System-Level)

1. No overselling under concurrent checkout.
2. Duplicate requests return prior result (idempotent).
3. Failed payment always restores inventory.
4. Failed compensation always lands in `SagaState` + ops alert.
5. Customer can query order status and receive update events.
6. Expired reservations are automatically released (no permanently locked inventory).
7. Every Lambda has a scoped IAM role (no `*` actions on production tables).
8. Full order saga visible in a single X-Ray trace.

---

## 5) Caveats and Tradeoffs Without Redis

- **Pros**
  - Lower complexity and lower ops overhead
  - Lower baseline cost (no ElastiCache cluster, often no NAT requirement)
  - Strong durability and consistency primitives natively in DynamoDB

- **Cons**
  - Higher latency than in-memory Redis for ultra-hot SKUs
  - Careful shard design required for flash-sale traffic
  - DynamoDB transactions have request-size and item-count limits

- **Decision trigger to add Redis later**
  - sustained hot-partition pressure despite shard tuning
  - strict sub-millisecond reservation requirement
  - extreme write burst profile that DynamoDB sharding cannot absorb economically

---

## 6) Risks and Mitigations (Updated)

| Risk | Impact | Mitigation |
|---|---|---|
| Hot SKU partition pressure | High | Increase shard count, adaptive shard routing, backoff + retry |
| Conditional check contention | Medium | bounded retries, jitter, order queue smoothing |
| Compensation failure | High | persist to `SagaState`, SNS alert, operational runbook |
| Duplicate client submissions | High | idempotency table + execution-name dedupe |
| External payment outage | High | circuit-breaker + retry policy + graceful failure messaging |

---

## 7) Cost Estimate (Portfolio / Low Traffic)

| Service | Estimate (monthly) | Notes |
|---|---|---|
| DynamoDB (on-demand) | ~$1-5 | Free tier covers most dev usage |
| Lambda | ~$0-1 | Free tier: 1M requests/mo |
| Step Functions Express | ~$0-1 | Per execution; minimal in dev |
| AppSync | ~$0-2 | Per query/mutation |
| API Gateway | ~$0-1 | Free tier: 1M calls/mo |
| SQS | ~$0 | Free tier: 1M requests/mo |
| SNS | ~$0 | Free tier: 1M publishes/mo |
| Cognito | $0 | Free under 50K MAU |
| CloudWatch | ~$0-5 | Logs + dashboards + alarms |
| **Total** | **~$2-15/mo** | Mostly within free tier for demo traffic |

**Removed vs. Redis design:**
- ElastiCache cluster: **-$50-500/mo**
- NAT Gateway: **-$35/mo**
- VPC complexity: **eliminated**

**At scale reference** (1000 orders/min, 3 items each):
- DynamoDB writes: ~3000/min × $1.25/M = ~$6/day ≈ **$180/mo** for inventory writes alone
- Total system at scale: ~$300-600/mo (still cheaper than Redis-first's $500-1500/mo)

---

## 8) Suggested Terraform Module Map

- `infrastructure/modules/dynamodb` (all tables + GSIs + TTL + streams)
- `infrastructure/modules/lambda` (functions + roles + env)
- `infrastructure/modules/step_functions` (saga + permissions)
- `infrastructure/modules/sqs` (order queue + DLQ)
- `infrastructure/modules/api_gateway`
- `infrastructure/modules/appsync`
- `infrastructure/modules/cognito`
- `infrastructure/modules/monitoring`
- `infrastructure/modules/security`

---

## 9) Recommended Execution Sequence (Simple)

1. Terraform foundation + CI scaffold
2. Auth (Cognito)
3. DynamoDB tables
4. Core order Lambdas (shared layer → inventory → orders → catalog)
5. Step Functions + SQS
6. API layer (AppSync + API Gateway)
7. Security tightening + observability
8. Test/load validate
9. CI/CD finalize

This sequence minimizes rework, keeps high-risk inventory logic testable early, and ensures CI runs from Phase 1 onward.

---

## 10) Portfolio Demonstration Checklist

These artifacts showcase the knowledge this project is designed to demonstrate:

- [ ] **Architecture diagram** — system-level view showing all AWS services and data flows
- [ ] **DynamoDB single-table and sharding design** — show access patterns
- [ ] **Step Functions saga visualization** — screenshot from AWS console showing happy + compensation paths
- [ ] **X-Ray trace map** — end-to-end order flow across Lambda → DynamoDB → SQS → Step Functions
- [ ] **Concurrency test results** — k6/Artillery output proving zero oversells
- [ ] **Terraform modules** — clean IaC demonstrating modular, reusable infrastructure
- [ ] **CI/CD pipeline** — GitHub Actions running lint → test → deploy
- [ ] **Lambda Powertools usage** — demonstrate Logger/Tracer/Idempotency integration as a best-practice pattern
- [ ] **README** with design decisions, tradeoffs (especially the Redis vs. DynamoDB analysis), and scaling notes

These items convert the codebase into a compelling portfolio piece that demonstrates distributed systems, serverless, IaC, and event-driven architecture skills.
