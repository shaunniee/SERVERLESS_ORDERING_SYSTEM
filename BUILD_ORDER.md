# Build Order & Implementation Plan

## High-Scale Event-Driven Order Processing System

**Generated:** 2026-03-04
**Target:** 10,000+ orders/min via Saga-based distributed architecture on AWS

---

## Current State Assessment

| Component | Status |
|-----------|--------|
| Terraform provider & variables | ✅ Done |
| Terraform remote backend (S3) | ⬜ Not started |
| `.gitignore` | ⬜ Not started |
| DynamoDB tables (+ GSI) | ⬜ Empty file exists |
| Lambda Layer (Powertools + SDK) | ⬜ Not started |
| Lambda functions | ⬜ Empty directories |
| IAM roles (per-Lambda) | ⬜ Not started |
| SQS / DLQ | ⬜ Not started |
| API Gateway (+ request validation) | ⬜ Not started |
| Step Functions (Express) | ⬜ Not started |
| EventBridge | ⬜ Not started |
| Observability (X-Ray, CloudWatch) | ⬜ Not started |
| Unit / integration tests | ⬜ Not started |
| Load testing (k6) | ⬜ Not started |

---

## Conventions

- **Terraform directory:** `infrastructure/`
- **Lambda source:** `backend/lambdas/`
- **Runtime:** Node.js 20.x (or Python 3.12 — choose one)
- **Naming prefix:** `${var.env}-${var.project_name}` → e.g. `dev-ser-ord-sys`
- **Region:** `eu-west-1`

---

## Phase 1 — Core Foundations

> **Goal:** Stand up project scaffolding, data layer, Lambda Layer, and the first Lambda.

### 1.0 Project Scaffolding

#### `.gitignore`

**File:** `.gitignore`

```
# Terraform
.terraform/
*.tfstate
*.tfstate.backup
.terraform.lock.hcl

# Lambda Layer build artifacts
backend/layers/shared-deps/nodejs/node_modules/
backend/layers/shared-deps/shared-deps-layer.zip

# Node
node_modules/

# OS
.DS_Store
```

#### Terraform Remote Backend

**File:** `infrastructure/backend.tf`

| Task | Details |
|------|---------||
| S3 bucket for state | `ser-ord-sys-terraform-state` (create manually or via bootstrap script) |
| DynamoDB table for locking | `ser-ord-sys-terraform-locks` (PK: `LockID`) |
| Backend block | `backend "s3" { bucket, key, region, dynamodb_table, encrypt = true }` |
| Run `terraform init` | Migrates local state to S3 |

#### Terraform Outputs (early)

**File:** `infrastructure/outputs.tf`

| Output | Value |
|--------|-------|
| `api_url` | `aws_api_gateway_deployment.*.invoke_url` |
| `orders_table_name` | `aws_dynamodb_table.orders.name` |
| `orders_table_arn` | `aws_dynamodb_table.orders.arn` |
| `inventory_table_name` | `aws_dynamodb_table.inventory.name` |
| `inventory_table_arn` | `aws_dynamodb_table.inventory.arn` |
| `order_queue_url` | `aws_sqs_queue.order_queue.url` |
| `dlq_url` | `aws_sqs_queue.order_dlq.url` |
| `state_machine_arn` | `aws_sfn_state_machine.saga.arn` |
| `event_bus_name` | `aws_cloudwatch_event_bus.orders.name` |
| `lambda_layer_arn` | `aws_lambda_layer_version.shared_deps.arn` |

Define stubs early so Terraform validates; values populate as resources are created in later phases.

### 1.1 DynamoDB Tables

**File:** `infrastructure/dynamodb.tf`

| Task | Details |
|------|---------||
| Create **Orders** table | PK: `orderId` (S), billing mode: PAY_PER_REQUEST |
| Create **Inventory** table | PK: `productId` (S), billing mode: PAY_PER_REQUEST |
| Enable point-in-time recovery | Both tables |
| Add TTL attribute (optional) | `expiresAt` on Orders for cleanup |
| **GSI: `userId-createdAt-index`** | PK: `userId` (S), SK: `createdAt` (S), projection: ALL — enables "get all orders for user" queries without table scans |
| Create **Idempotency** table | PK: `id` (S), TTL on `expiration`, PAY_PER_REQUEST — used by Powertools Idempotency to cache responses and prevent duplicate order creation |

### 1.2 IAM Foundation (Per-Lambda Least Privilege)

**File:** `infrastructure/iam.tf`

Each Lambda gets its **own IAM role** with only the permissions it needs. A compromised or mis-coded function cannot access resources it doesn't use.

| Role | Attached to | Permissions |
|------|-------------|-------------|
| `createOrder-role` | createOrder | DynamoDB PutItem (Orders), DynamoDB PutItem/GetItem/UpdateItem/DeleteItem (Idempotency), SQS SendMessage, X-Ray, CloudWatch Logs |
| `processOrder-role` | processOrder | DynamoDB GetItem (Orders), SFN StartExecution, X-Ray, CloudWatch Logs |
| `reserveInventory-role` | reserveInventory | DynamoDB UpdateItem (Inventory), X-Ray, CloudWatch Logs |
| `releaseInventory-role` | releaseInventory | DynamoDB UpdateItem (Inventory), X-Ray, CloudWatch Logs |
| `processPayment-role` | processPayment | DynamoDB UpdateItem (Orders), X-Ray, CloudWatch Logs |
| `refundPayment-role` | refundPayment | DynamoDB UpdateItem (Orders), X-Ray, CloudWatch Logs |
| `confirmOrder-role` | confirmOrder | DynamoDB UpdateItem (Orders), X-Ray, CloudWatch Logs |
| `failOrder-role` | failOrder | DynamoDB UpdateItem (Orders), X-Ray, CloudWatch Logs |
| `emitEvent-role` | emitEvent | DynamoDB GetItem (Orders), EventBridge PutEvents, X-Ray, CloudWatch Logs |
| `replayDlq-role` | replayDlq | SQS ReceiveMessage (DLQ) + SendMessage (main queue), X-Ray, CloudWatch Logs |
| `getOrder-role` | getOrder | DynamoDB GetItem + Query (Orders), X-Ray, CloudWatch Logs |
| `stepfunctions-role` | Step Functions | Lambda InvokeFunction (saga Lambdas only) |

**Tip:** Use a Terraform `locals` block with a role-definition map to avoid repetition, then `for_each` over it.

### 1.3 Lambda Layer (Shared Dependencies)

A Lambda Layer packages shared runtime dependencies and utility code so every function uses the same versions without bundling them individually. This reduces deployment size and ensures consistency.

**Directory:** `backend/layers/shared-deps/`

**File:** `backend/layers/shared-deps/package.json`

| Dependency | Version | Purpose |
|------------|---------|---------|
| `@aws-sdk/client-dynamodb` | `^3.x` | DynamoDB operations |
| `@aws-sdk/lib-dynamodb` | `^3.x` | DynamoDB document client (marshalling) |
| `@aws-sdk/client-sqs` | `^3.x` | SQS send/receive messages |
| `@aws-sdk/client-sfn` | `^3.x` | Start Step Functions executions |
| `@aws-sdk/client-eventbridge` | `^3.x` | Put events to EventBridge |
| `@aws-lambda-powertools/logger` | `^2.x` | Structured JSON logging with correlation IDs |
| `@aws-lambda-powertools/tracer` | `^2.x` | X-Ray tracing with automatic AWS SDK instrumentation |
| `@aws-lambda-powertools/metrics` | `^2.x` | Custom CloudWatch metrics (EMF) |
| `@aws-lambda-powertools/idempotency` | `^2.x` | Idempotency for createOrder (DynamoDB-backed) |
| `@middy/core` | `^5.x` | Lambda middleware engine (used by Powertools) |

> **Note:** AWS SDK v3 is included in the Node.js 20.x runtime but bundling it in the layer pins the version and enables X-Ray auto-capture via Powertools Tracer. The `uuid` package is dropped — use `crypto.randomUUID()` (built into Node 20).

**Build script:** `backend/layers/shared-deps/build_layer.sh`

```bash
#!/bin/bash
set -e
cd "$(dirname "$0")"
rm -rf nodejs package
mkdir -p nodejs
cp package.json nodejs/
cd nodejs && npm install --omit=dev
cd ..
zip -r shared-deps-layer.zip nodejs/
echo "Layer artifact: shared-deps-layer.zip"
```

**Layer structure (required by AWS):**

```
shared-deps-layer.zip
└── nodejs/
    ├── package.json
    └── node_modules/
        ├── @aws-sdk/client-dynamodb/
        ├── @aws-sdk/lib-dynamodb/
        ├── @aws-sdk/client-sqs/
        ├── @aws-sdk/client-sfn/
        ├── @aws-sdk/client-eventbridge/
        ├── @aws-lambda-powertools/logger/
        ├── @aws-lambda-powertools/tracer/
        ├── @aws-lambda-powertools/metrics/
        ├── @aws-lambda-powertools/idempotency/
        └── @middy/core/
```

**Terraform:** `infrastructure/lambda_layer.tf`

| Task | Details |
|------|---------|
| `aws_lambda_layer_version` | Name: `dev-ser-ord-sys-shared-deps` |
| Compatible runtimes | `["nodejs20.x"]` |
| Source | `backend/layers/shared-deps/shared-deps-layer.zip` |
| `source_code_hash` | `filebase64sha256("...shared-deps-layer.zip")` — redeploys layer only when zip changes |
| Description | AWS SDK clients, Lambda Powertools, shared utilities |

**Utility modules included in layer:** `backend/layers/shared-deps/nodejs/lib/`

| Module | File | Exports |
|--------|------|---------|
| Response helper | `response.mjs` | `success(body)`, `error(statusCode, message)` |
| DynamoDB client | `dynamodb.mjs` | Pre-configured `DynamoDBDocumentClient` with Tracer |
| SQS client | `sqs.mjs` | Pre-configured `SQSClient` with Tracer |
| Step Functions client | `sfn.mjs` | Pre-configured `SFNClient` with Tracer |
| EventBridge client | `eventbridge.mjs` | Pre-configured `EventBridgeClient` with Tracer |

> **Logger and Tracer are NOT wrapped in lib files** — each Lambda instantiates its own `Logger` and `Tracer` with the function's `serviceName` for proper correlation.

Lambda functions import from the layer at runtime:

```javascript
// In any Lambda handler — no local node_modules needed
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { success, error } from '/opt/nodejs/lib/response.mjs';
import { docClient } from '/opt/nodejs/lib/dynamodb.mjs';

const logger = new Logger({ serviceName: 'createOrder' });
const tracer = new Tracer({ serviceName: 'createOrder' });
```

### 1.4 Create Order Lambda (API Lambda)

**File:** `backend/lambdas/orders/createOrder/index.mjs`

| Task | Details |
|------|---------|
| Validate incoming request body | `userId`, `items[]`, `totalAmount` required || Wrapped with `makeIdempotent` | Powertools hashes the request `body`, stores in Idempotency table. Duplicate payloads within 1 hour return cached response without re-executing || Generate `orderId` (UUID) | Use `crypto.randomUUID()` |
| Idempotent write to Orders table | `ConditionExpression: attribute_not_exists(orderId)` |
| Set initial status | `PENDING` |
| Send message to SQS | Include `orderId` in message body |
| Return `201` with `orderId` | |

### 1.5 Terraform for Create Order Lambda

**File:** `infrastructure/lambda.tf`

| Task | Details |
|------|---------|
| `data "archive_file"` for createOrder | Auto-zip source on `terraform apply` |
| `aws_lambda_function` for createOrder | Runtime, handler, env vars, timeout, memory |
| `source_code_hash` | `data.archive_file.createOrder.output_base64sha256` — redeploys only on code change |
| Attach Lambda Layer | `layers = [aws_lambda_layer_version.shared_deps.arn]` |
| Attach per-Lambda IAM role | `role = aws_iam_role.createOrder.arn` |
| Powertools env vars | `POWERTOOLS_SERVICE_NAME`, `POWERTOOLS_LOG_LEVEL`, `POWERTOOLS_TRACER_CAPTURE_RESPONSE` |
| Idempotency env var | `IDEMPOTENCY_TABLE = aws_dynamodb_table.idempotency.name` |
| CloudWatch log group | `/aws/lambda/createOrder`, 14-day retention |
| Lambda permission for API Gateway | (wired in Phase 2) |

> **Pattern for all Lambdas:** Every function in `lambda.tf` should follow this template — `archive_file` → `aws_lambda_function` (with layer + own role + Powertools env vars) → `aws_cloudwatch_log_group`. Use `for_each` or Terraform modules to avoid repetition across 11 functions.

### 1.6 Seed Inventory Data (helper script)

**File:** `scripts/seed_inventory.sh` (or `.mjs`)

| Task | Details |
|------|---------|
| Insert sample products | 5–10 products with stock quantities |
| Use AWS CLI `put-item` | Idempotent, safe to re-run |

### Phase 1 — Definition of Done

- [x] `.gitignore` committed — build artifacts excluded
- [x] Terraform remote backend configured (`terraform init` migrates to S3)
- [x] `outputs.tf` stubs created (values populate as resources are added)
- [x] `terraform apply` creates DynamoDB tables (Orders with GSI, Inventory, Idempotency)
- [x] Lambda Layer built and published with Powertools + AWS SDK clients
- [x] createOrder Lambda deploys with layer attached and per-function IAM role
- [x] Shared utility imports (`/opt/nodejs/lib/*`) and Powertools resolve correctly at runtime
- [x] Idempotent write verified (duplicate `orderId` rejected)
- [x] Powertools Idempotency verified (same request body returns cached response, no duplicate order created)

---

## Phase 2 — API Gateway + Queue Layer

> **Goal:** Expose a public endpoint and buffer orders through SQS.

### 2.1 API Gateway (REST)

**File:** `infrastructure/api_gateway.tf`

| Task | Details |
|------|---------|
| Create REST API | `dev-ser-ord-sys-api` |
| `POST /orders` resource + method | Integration with createOrder Lambda |
| **Request validation** | Add JSON Schema model on `POST /orders` — API Gateway rejects malformed requests *before* Lambda is invoked (saves cost + catches bad input at the edge) |
| `GET /orders/{orderId}` resource + method | Integration with getOrder Lambda — returns order status |
| Deploy stage | `dev` |
| Enable throttling | 200 req/s burst, 100 req/s sustained |
| Enable CloudWatch logging | Access + execution logs |

**Request model (JSON Schema):**

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "required": ["userId", "items", "totalAmount"],
  "properties": {
    "userId": { "type": "string", "minLength": 1 },
    "items": {
      "type": "array", "minItems": 1,
      "items": {
        "type": "object",
        "required": ["productId", "qty"],
        "properties": {
          "productId": { "type": "string" },
          "qty": { "type": "integer", "minimum": 1 }
        }
      }
    },
    "totalAmount": { "type": "number", "minimum": 0.01 }
  }
}
```

### 2.2 SQS Queue + Dead Letter Queue

**File:** `infrastructure/sqs.tf`

| Task | Details |
|------|---------|
| Create main queue | `dev-ser-ord-sys-order-queue` |
| Create DLQ | `dev-ser-ord-sys-order-dlq` |
| Redrive policy | `maxReceiveCount: 3` → DLQ |
| Visibility timeout | 6× Lambda timeout (e.g. 180s) |
| Message retention | 4 days (DLQ: 14 days) |

### 2.3 Processor Lambda (SQS consumer)

**File:** `backend/lambdas/orders/processOrder/index.mjs`

| Task | Details |
|------|---------|
| SQS event source mapping | Batch size 10, max concurrency configured |
| Parse order message | Extract `orderId` |
| **Idempotent saga start** | Use `orderId` as Step Functions execution `name` — AWS automatically rejects duplicate executions. This prevents the same order from triggering multiple saga runs if SQS delivers the message more than once |
| Handle partial batch failures | Return `batchItemFailures` |

**File:** `infrastructure/lambda.tf` (append)

| Task | Details |
|------|---------|
| `aws_lambda_function` for processOrder | |
| `aws_lambda_event_source_mapping` | SQS → processOrder |

### 2.4 DLQ Replay Lambda

**File:** `backend/lambdas/orders/replayDlq/index.mjs`

| Task | Details |
|------|---------|
| Read from DLQ | Manual invocation or scheduled |
| Re-send messages to main queue | With deduplication |

### 2.5 Get Order Lambda

**File:** `backend/lambdas/orders/getOrder/index.mjs`

| Task | Details |
|------|---------||
| `GET /orders/{orderId}` handler | Extract `orderId` from path parameters |
| DynamoDB GetItem on Orders table | Return full order record |
| Return `200` with order data | Or `404` if not found |
| Used during load test | To verify orders reached `CONFIRMED` / `FAILED` status |

### Phase 2 — Definition of Done

- [x] `POST /orders` returns `201` via API Gateway
- [x] Malformed requests rejected by API Gateway request validator (never hit Lambda)
- [x] `GET /orders/{orderId}` returns order status
- [x] Message appears in SQS
- [x] processOrder Lambda triggered by SQS
- [x] Duplicate `orderId` execution names rejected by Step Functions
- [x] Failed messages land in DLQ after 3 retries

---

## Phase 3 — Saga Orchestration (Step Functions)

> **Goal:** Implement the full saga workflow with compensation.

### 3.1 Step Functions State Machine

**File:** `infrastructure/step_functions.tf`

| Task | Details |
|------|---------|
| Define state machine (ASL JSON) | Linear saga with catch blocks |
| IAM role for Step Functions | Invoke Lambdas |
| Express workflow type | For high throughput (< 5 min duration) |

### 3.2 Saga Step Lambdas

Each Lambda is a small, single-purpose function:

| Lambda | File | Action | Compensation |
|--------|------|--------|--------------|
| **reserveInventory** | `backend/lambdas/orders/reserveInventory/index.mjs` | Decrement `stock` with condition `stock >= qty` | releaseInventory |
| **releaseInventory** | `backend/lambdas/orders/releaseInventory/index.mjs` | Increment `stock` back | — |
| **processPayment** | `backend/lambdas/orders/processPayment/index.mjs` | Simulate payment (random failure via `FAIL_PAYMENT_PERCENT`) | refundPayment |
| **refundPayment** | `backend/lambdas/orders/refundPayment/index.mjs` | Log refund action | — |
| **confirmOrder** | `backend/lambdas/orders/confirmOrder/index.mjs` | Update order status → `CONFIRMED` | — |
| **failOrder** | `backend/lambdas/orders/failOrder/index.mjs` | Update order status → `FAILED`, record failure reason | — |

### 3.3 State Machine Flow (ASL)

```
StartAt: ReserveInventory

ReserveInventory
  ├─ Success → ProcessPayment
  └─ Catch  → FailOrder

ProcessPayment
  ├─ Success → ConfirmOrder
  └─ Catch  → ReleaseInventory → FailOrder

ConfirmOrder
  ├─ Success → EmitOrderPlaced
  └─ Catch  → RefundPayment → ReleaseInventory → FailOrder

EmitOrderPlaced
  └─ End
```

### 3.4 Retry Configuration (per state)

```json
{
  "Retry": [
    {
      "ErrorEquals": ["States.TaskFailed"],
      "IntervalSeconds": 2,
      "MaxAttempts": 3,
      "BackoffRate": 2.0
    }
  ]
}
```

### 3.5 Failure Injection

**Environment variable on processPayment Lambda:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `FAIL_PAYMENT_PERCENT` | `20` | % of payments that fail randomly |

### Phase 3 — Definition of Done

- [x] Step Functions execution completes the happy path
- [x] Inventory decremented and order marked CONFIRMED
- [x] Payment failure triggers compensation (release inventory, fail order)
- [x] Inventory reservation failure immediately fails saga
- [x] All states have retry + catch configured

---

## Phase 4 — Event Publishing (EventBridge)

> **Goal:** Publish domain events for downstream consumers.

### 4.1 EventBridge Setup

**File:** `infrastructure/eventbridge.tf`

| Task | Details |
|------|---------|
| Create custom event bus | `dev-ser-ord-sys-events` |
| Event rule for `OrderPlaced` | Pattern: `{ "detail-type": ["OrderPlaced"] }` |
| Target: CloudWatch log group | For observability of events |
| (Optional) Target: SNS or another Lambda | Sample consumer |

### 4.2 Emit Event Lambda

**File:** `backend/lambdas/orders/emitEvent/index.mjs`

| Task | Details |
|------|---------|
| Called as last saga step | After confirmOrder succeeds |
| Put event to EventBridge | Source: `ordering-system`, detail-type: `OrderPlaced` |
| Include order payload | `orderId`, `userId`, `totalAmount`, `timestamp` |

### Phase 4 — Definition of Done

- [x] `OrderPlaced` event visible in CloudWatch Logs
- [x] EventBridge rule matches and routes correctly
- [x] Event schema documented

---

## Phase 5 — Observability

> **Goal:** Full visibility into system health and performance.

### 5.1 X-Ray Tracing

**File:** `infrastructure/lambda.tf` (update)

| Task | Details |
|------|---------|
| Enable `tracing_config { mode = "Active" }` | All Lambdas |
| X-Ray SDK already in Lambda Layer | `aws-xray-sdk-core` captures AWS SDK calls automatically |
| Enable on API Gateway | Stage-level setting |
| Enable on Step Functions | `tracingConfiguration` |

### 5.2 Structured Logging

**File:** Already in Lambda Layer at `nodejs/lib/logger.mjs`

| Task | Details |
|------|---------|
| JSON-structured logger | Uses `console.log(JSON.stringify(...))` |
| Correlation ID | Propagate `orderId` through all logs |
| Log levels | INFO, WARN, ERROR |
| All Lambdas import from layer | `import { logger } from '/opt/nodejs/lib/logger.mjs'` |

### 5.3 CloudWatch Dashboard

**File:** `infrastructure/cloudwatch.tf`

| Task | Details |
|------|---------|
| Create dashboard | `dev-ser-ord-sys-dashboard` |
| Widget: Orders/sec | API Gateway `Count` metric |
| Widget: Saga success vs failure | Step Functions `ExecutionsSucceeded` / `ExecutionsFailed` |
| Widget: DLQ depth | SQS `ApproximateNumberOfMessagesVisible` |
| Widget: P95 Lambda duration | Per-function latency |
| Widget: Concurrent executions | Lambda `ConcurrentExecutions` |

### 5.4 CloudWatch Alarms

| Alarm | Threshold | Action |
|-------|-----------|--------|
| DLQ depth > 10 | 10 messages | SNS notification |
| Saga failure rate > 30% | 30% over 5 min | SNS notification |
| API 5xx rate > 5% | 5% over 5 min | SNS notification |

### Phase 5 — Definition of Done

- [x] Traces visible end-to-end in X-Ray console (via Powertools Tracer)
- [x] Structured logs with correlation IDs in CloudWatch (via Powertools Logger)
- [x] Custom metrics emitted to CloudWatch namespace `OrderingSystem` (via Powertools Metrics)
- [x] Dashboard shows all widgets with live data
- [x] Alarms fire correctly on simulated failures

---

## Phase 5.5 — Unit & Integration Tests

> **Goal:** Validate Lambda handler logic before deploying to AWS.

### Test Framework Setup

**File:** `tests/package.json`

| Dependency | Purpose |
|------------|---------||
| `vitest` (or `jest`) | Test runner |
| `@aws-sdk/client-dynamodb` | Type definitions for mocking |
| `aws-sdk-client-mock` | Mock AWS SDK v3 clients |

### Unit Tests

**Directory:** `tests/unit/`

| Test File | Covers | Key Assertions |
|-----------|--------|-----------------|
| `createOrder.test.mjs` | createOrder handler | Validates request, writes to DynamoDB, sends SQS message, rejects duplicates |
| `reserveInventory.test.mjs` | reserveInventory | Decrements stock, throws on insufficient stock |
| `processPayment.test.mjs` | processPayment | Succeeds normally, fails at configured percentage |
| `confirmOrder.test.mjs` | confirmOrder | Updates status to CONFIRMED |
| `failOrder.test.mjs` | failOrder | Updates status to FAILED with reason |
| `emitEvent.test.mjs` | emitEvent | Publishes correct event shape to EventBridge |
| `getOrder.test.mjs` | getOrder | Returns order or 404 |
| `processOrder.test.mjs` | processOrder | Starts execution with orderId as name, handles batch failures |

### Integration Tests (optional, against deployed stack)

**Directory:** `tests/integration/`

| Test File | Covers |
|-----------|--------|
| `orderFlow.test.mjs` | POST order → check SQS → verify DynamoDB status after saga completes |

### Commands

```bash
cd tests
npm install
npm test              # Run all unit tests
npm run test:int      # Run integration tests (requires deployed stack)
```

---

## Phase 6 — Load Testing & Performance Validation

> **Goal:** Prove the system handles 10,000 orders/min sustained.

### 6.1 k6 Test Script

**File:** `tests/load/k6_order_test.js`

| Task | Details |
|------|---------|
| Ramp-up | 0 → 167 VUs over 1 minute |
| Sustained load | 167 VUs for 10 minutes (~10k orders/min) |
| Ramp-down | 167 → 0 over 1 minute |
| Assertions | P95 < 500ms, success rate > 95% |

### 6.2 Concurrency Tuning

**File:** `infrastructure/lambda.tf` (update)

| Task | Details |
|------|---------|
| Reserved concurrency on processOrder | `100` (tunable) |
| SQS `MaximumConcurrency` | Match reserved concurrency |
| Provisioned concurrency (optional) | Reduce cold starts |

### 6.3 Results Capture

**File:** `tests/load/results/`

| Task | Details |
|------|---------|
| Export k6 summary JSON | `--out json=results.json` |
| Screenshot CloudWatch dashboard | Before/during/after |
| Document findings | `tests/load/RESULTS.md` |

### Phase 6 — Definition of Done

- [x] Sustained 10k orders/min for 10 minutes
- [x] P95 latency < 500ms
- [x] DLQ depth stays near 0 (excluding injected failures)
- [x] Compensation rate aligns with `FAIL_PAYMENT_PERCENT`
- [x] Results documented with metrics

---

## File Manifest (Final State)

```
SERVERLESS_ORDERING_SYSTEM/
├── .gitignore                                  ← Exclude build artifacts, .terraform, node_modules
├── BUILD_ORDER.md                              ← This file
├── project_details.md
├── README.md
│
├── backend/
│   ├── layers/
│   │   └── shared-deps/
│   │       ├── package.json                    ← Powertools + AWS SDK dependencies
│   │       ├── build_layer.sh                  ← Build + zip the layer
│   │       ├── shared-deps-layer.zip           ← Built artifact (gitignored)
│   │       └── nodejs/
│   │           ├── node_modules/               ← Installed deps (gitignored)
│   │           └── lib/
│   │               ├── response.mjs            ← HTTP response helper
│   │               ├── dynamodb.mjs            ← DynamoDB document client (Tracer-wrapped)
│   │               ├── sqs.mjs                 ← SQS client (Tracer-wrapped)
│   │               ├── sfn.mjs                 ← Step Functions client (Tracer-wrapped)
│   │               └── eventbridge.mjs         ← EventBridge client (Tracer-wrapped)
│   └── lambdas/
│       └── orders/
│           ├── createOrder/index.mjs           ← API: validate + write + enqueue
│           ├── getOrder/index.mjs              ← API: get order by ID or query by userId
│           ├── processOrder/index.mjs          ← SQS consumer → start saga (idempotent)
│           ├── reserveInventory/index.mjs      ← Saga step 1
│           ├── releaseInventory/index.mjs      ← Compensation: undo reservation
│           ├── processPayment/index.mjs        ← Saga step 2 (failure injection)
│           ├── refundPayment/index.mjs         ← Compensation: undo payment
│           ├── confirmOrder/index.mjs          ← Saga step 3
│           ├── failOrder/index.mjs             ← Mark order FAILED
│           ├── emitEvent/index.mjs             ← Publish to EventBridge
│           └── replayDlq/index.mjs             ← DLQ replay utility
│
├── infrastructure/
│   ├── main.tf                                 ← Provider config (exists)
│   ├── backend.tf                              ← S3 remote state + DynamoDB locking
│   ├── variables.tf                            ← Variables (exists)
│   ├── var.tfvars                              ← Variable values (exists)
│   ├── outputs.tf                              ← API URL, table ARNs, queue URLs, etc.
│   ├── dynamodb.tf                             ← Orders (+ GSI) + Inventory tables
│   ├── iam.tf                                  ← Per-Lambda IAM roles + policies
│   ├── lambda_layer.tf                         ← Lambda Layer definition
│   ├── lambda.tf                               ← All Lambda functions (archive_file + layer + role)
│   ├── api_gateway.tf                          ← REST API + POST /orders + GET /orders/{id} + request validation
│   ├── sqs.tf                                  ← Queue + DLQ
│   ├── step_functions.tf                       ← Saga state machine (Express)
│   ├── eventbridge.tf                          ← Event bus + rules
│   └── cloudwatch.tf                           ← Dashboard + alarms
│
├── scripts/
│   └── seed_inventory.sh                       ← Seed products into DynamoDB
│
└── tests/
    ├── package.json                            ← Test framework deps (vitest, sdk-mock)
    ├── unit/                                   ← Unit tests for each Lambda handler
    │   ├── createOrder.test.mjs
    │   ├── getOrder.test.mjs
    │   ├── processOrder.test.mjs
    │   ├── reserveInventory.test.mjs
    │   ├── processPayment.test.mjs
    │   ├── confirmOrder.test.mjs
    │   ├── failOrder.test.mjs
    │   └── emitEvent.test.mjs
    ├── integration/                            ← Integration tests (against deployed stack)
    │   └── orderFlow.test.mjs
    └── load/
        ├── k6_order_test.js                    ← k6 load test script
        └── results/
            └── RESULTS.md                      ← Performance findings
```

---

## Dependency Graph

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4
                                       │
                                       ▼
                                   Phase 5 ──► Phase 5.5 ──► Phase 6
```

- **Phase 1** is a prerequisite for everything (.gitignore, remote backend, data layer, Lambda Layer, first Lambda).
- **Phase 2** depends on Phase 1 (needs tables + createOrder Lambda + layer).
- **Phase 3** depends on Phase 2 (processOrder triggers saga).
- **Phase 4** depends on Phase 3 (emitEvent is the last saga step).
- **Phase 5** can be partially done in parallel with Phases 2–4 (Powertools is already in the layer), but dashboards/alarms need metrics from running services.
- **Phase 5.5** unit tests can be written incrementally alongside each phase; integration tests require the full stack.
- **Phase 6** requires all prior phases to be functional.

---

## Lambda Layer — Dependencies & Connections Map

This section documents which AWS SDK clients and shared utilities each Lambda function uses via the shared layer.

### Layer Import Paths

All Lambdas import shared code from the layer at `/opt/nodejs/` (AWS Lambda Layer mount point):

| Import | Path at Runtime |
|--------|----------------|
| AWS SDK packages | `/opt/nodejs/node_modules/@aws-sdk/*` (auto-resolved by Node) |
| Powertools Logger | `/opt/nodejs/node_modules/@aws-lambda-powertools/logger` |
| Powertools Tracer | `/opt/nodejs/node_modules/@aws-lambda-powertools/tracer` |
| Powertools Metrics | `/opt/nodejs/node_modules/@aws-lambda-powertools/metrics` |
| Powertools Idempotency | `/opt/nodejs/node_modules/@aws-lambda-powertools/idempotency` |
| Response helper | `/opt/nodejs/lib/response.mjs` |
| DynamoDB client | `/opt/nodejs/lib/dynamodb.mjs` |
| SQS client | `/opt/nodejs/lib/sqs.mjs` |
| Step Functions client | `/opt/nodejs/lib/sfn.mjs` |
| EventBridge client | `/opt/nodejs/lib/eventbridge.mjs` |

### Per-Lambda Dependency Matrix

| Lambda | DynamoDB | SQS | Step Functions | EventBridge | Response | Logger | Tracer | Metrics | Idempotency |
|--------|:--------:|:---:|:--------------:|:-----------:|:--------:|:------:|:------:|:-------:|:-----------:|
| **createOrder** | ✅ PutItem | ✅ SendMessage | — | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| **getOrder** | ✅ GetItem/Query | — | — | — | ✅ | ✅ | ✅ | — | — |
| **processOrder** | ✅ GetItem | — | ✅ StartExecution | — | — | ✅ | ✅ | ✅ | — |
| **reserveInventory** | ✅ UpdateItem | — | — | — | — | ✅ | ✅ | ✅ | — |
| **releaseInventory** | ✅ UpdateItem | — | — | — | — | ✅ | ✅ | — | — |
| **processPayment** | ✅ UpdateItem | — | — | — | — | ✅ | ✅ | ✅ | — |
| **refundPayment** | ✅ UpdateItem | — | — | — | — | ✅ | ✅ | — | — |
| **confirmOrder** | ✅ UpdateItem | — | — | — | — | ✅ | ✅ | — | — |
| **failOrder** | ✅ UpdateItem | — | — | — | — | ✅ | ✅ | ✅ | — |
| **emitEvent** | ✅ GetItem | — | — | ✅ PutEvents | — | ✅ | ✅ | ✅ | — |
| **replayDlq** | — | ✅ Receive+Send | — | — | — | ✅ | ✅ | — | — |

### Service Connection Diagram

```
                          ┌──────────────────────────────────────────┐
                          │         Lambda Layer (shared-deps)       │
                          │                                          │
                          │  @aws-sdk/client-dynamodb                │
                          │  @aws-sdk/lib-dynamodb                   │
                          │  @aws-sdk/client-sqs                     │
                          │  @aws-sdk/client-sfn                     │
                          │  @aws-sdk/client-eventbridge             │
                          │  @aws-lambda-powertools/logger           │
                          │  @aws-lambda-powertools/tracer           │
                          │  @aws-lambda-powertools/metrics          │
                          │  @aws-lambda-powertools/idempotency      │
                          │  lib/response.mjs                        │
                          │  lib/dynamodb.mjs → DynamoDB Client      │
                          │  lib/sqs.mjs → SQS Client                │
                          │  lib/sfn.mjs → SFN Client                │
                          │  lib/eventbridge.mjs → EB Client         │
                          └──────────┬───────────────────────────────┘
                                     │ attached to ALL Lambdas
        ┌────────────────────────────┼────────────────────────────────┐
        │                            │                                │
        ▼                            ▼                                ▼
┌───────────────┐  ┌──────────────────────────┐  ┌───────────────────────────┐
│  API Gateway  │  │   SQS (order-queue)      │  │   Step Functions (Express) │
│  POST /orders │  │                          │  │   (saga state machine)    │
│  GET /orders/ │  │                          │  │                           │
└───────┬───────┘  └──────────┬───────────────┘  └─────────┬─────────────────┘
        │                     │                            │
        ├─► createOrder ──► SQS processOrder ──────►    Saga Steps:
        │   (DynamoDB write)      (starts execution,       ┌─ reserveInventory ──► DynamoDB (Inventory)
        │                          orderId as exec name)   ├─ processPayment ───► DynamoDB (Orders)
        │                                                  ├─ confirmOrder ─────► DynamoDB (Orders)
        │                                                  └─ emitEvent ────────► EventBridge
        │                                                  Compensations:
        │                                                  ├─ releaseInventory ─► DynamoDB (Inventory)
        │                                                  ├─ refundPayment ────► DynamoDB (Orders)
        │                                                  └─ failOrder ────────► DynamoDB (Orders)
        │
        └─► getOrder                      DLQ ◄── failed SQS messages
            (DynamoDB read/query)           │
                                            ▼
                                        replayDlq ───► SQS (re-enqueue)
```

### Environment Variables (per Lambda, passed via Terraform)

| Variable | Used By | Source |
|----------|---------|--------|
| `ORDERS_TABLE` | createOrder, getOrder, confirmOrder, failOrder, processPayment, refundPayment, emitEvent | `aws_dynamodb_table.orders.name` |
| `INVENTORY_TABLE` | reserveInventory, releaseInventory | `aws_dynamodb_table.inventory.name` |
| `IDEMPOTENCY_TABLE` | createOrder | `aws_dynamodb_table.idempotency.name` |
| `ORDER_QUEUE_URL` | createOrder, replayDlq | `aws_sqs_queue.order_queue.url` |
| `DLQ_URL` | replayDlq | `aws_sqs_queue.order_dlq.url` |
| `STATE_MACHINE_ARN` | processOrder | `aws_sfn_state_machine.saga.arn` |
| `EVENT_BUS_NAME` | emitEvent | `aws_cloudwatch_event_bus.orders.name` |
| `FAIL_PAYMENT_PERCENT` | processPayment | Hardcoded or from `var.tfvars` |
| `POWERTOOLS_SERVICE_NAME` | All Lambdas | Set to function name (e.g. `createOrder`) |
| `POWERTOOLS_LOG_LEVEL` | All Lambdas | `INFO` (dev) / `WARN` (prod) |
| `POWERTOOLS_TRACER_CAPTURE_RESPONSE` | All Lambdas | `true` |
| `POWERTOOLS_METRICS_NAMESPACE` | All Lambdas | `OrderingSystem` |

### Layer Update Workflow

When dependencies change:

```bash
# 1. Update package.json in the layer
cd backend/layers/shared-deps
vim package.json

# 2. Rebuild the zip
bash build_layer.sh

# 3. Terraform detects the new zip hash and publishes a new layer version
cd ../../../infrastructure
terraform apply -var-file="var.tfvars"

# 4. All Lambdas automatically get the latest layer version
#    (Terraform updates the layer ARN reference)
```

---

## Estimated Effort

| Phase | Effort | Notes |
|-------|--------|-------|
| Phase 1 | 4–5 hours | .gitignore, remote backend, outputs, tables (GSI), IAM (per-Lambda), Lambda Layer (Powertools), first Lambda |
| Phase 2 | 3–4 hours | API Gateway (+ request validation + GET endpoint), SQS, processor Lambda |
| Phase 3 | 4–6 hours | Step Functions (Express) + 6 saga Lambdas + ASL |
| Phase 4 | 1–2 hours | EventBridge bus, rule, emitEvent Lambda |
| Phase 5 | 2–3 hours | Powertools Tracer/Logger/Metrics config, dashboard, alarms |
| Phase 5.5 | 2–3 hours | Unit tests (vitest + aws-sdk-client-mock), integration test |
| Phase 6 | 2–3 hours | k6 script, tuning, results capture |
| **Total** | **~18–26 hours** | |

---

## Quick Reference: Key Commands

```bash
# Terraform
cd infrastructure
terraform init
terraform plan -var-file="var.tfvars"
terraform apply -var-file="var.tfvars"

# Build Lambda Layer
cd backend/layers/shared-deps && bash build_layer.sh && cd -

# Seed inventory
bash scripts/seed_inventory.sh

# Test createOrder locally
aws lambda invoke --function-name dev-ser-ord-sys-createOrder \
  --payload '{"body":"{\"userId\":\"u1\",\"items\":[{\"productId\":\"p1\",\"qty\":2}],\"totalAmount\":50}"}' \
  /dev/stdout

# Get order status
aws lambda invoke --function-name dev-ser-ord-sys-getOrder \
  --payload '{"pathParameters":{"orderId":"<ORDER_ID>"}}' \
  /dev/stdout

# Run unit tests
cd tests && npm test

# Run load test
k6 run tests/load/k6_order_test.js

# Check DLQ depth
aws sqs get-queue-attributes \
  --queue-url <DLQ_URL> \
  --attribute-names ApproximateNumberOfMessagesVisible
```
