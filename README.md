# Serverless Ordering System

A high-throughput, event-driven order processing system built entirely on AWS serverless services. Handles 10,000+ orders/min using the Saga pattern for distributed transactions, with automatic compensation on failure.

> **Portfolio project** — demonstrates distributed systems design, serverless architecture, Infrastructure as Code, and event-driven patterns.

---

## Architecture

```
Client
  │
  ▼
API Gateway (REST)
  │
  ├─ POST /orders ──► createOrder Lambda
  │                      │
  │                      ├──► DynamoDB (Orders table, status: PENDING)
  │                      └──► SQS Order Queue
  │                              │
  │                              ▼
  │                        processOrder Lambda
  │                              │
  │                              ▼
  │                     Step Functions (Express)
  │                     ┌────────────────────────────┐
  │                     │ 1. Reserve Inventory       │
  │                     │ 2. Process Payment         │
  │                     │ 3. Confirm Order           │
  │                     │ 4. Emit Event (EventBridge)│
  │                     │                            │
  │                     │ Compensation on failure:   │
  │                     │  └─ Release Inventory      │
  │                     │  └─ Refund Payment         │
  │                     │  └─ Fail Order             │
  │                     └────────────────────────────┘
  │
  └─ GET /orders/{orderId} ──► getOrder Lambda ──► DynamoDB
```

## Key Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Workflow orchestration | Step Functions Express (Saga) | Automatic compensation on failure; cheaper than Standard for <5 min workflows |
| Inventory consistency | DynamoDB conditional writes | `stock >= qty` condition prevents overselling |
| Idempotency | Lambda Powertools + DynamoDB `attribute_not_exists` | Two-layer protection: request body hash (1hr TTL) + conditional write |
| API validation | JSON Schema model on API Gateway | Rejects malformed requests before Lambda invocation (cost savings) |
| Queue resilience | SQS + DLQ + replayDlq Lambda | Failed messages retry 3×, then move to DLQ for manual replay |
| Partial batch failures | `ReportBatchItemFailures` | Only failed SQS messages retry; successful ones are deleted |
| Observability | Lambda Powertools (Logger, Tracer, Metrics) | Structured JSON logs, X-Ray tracing, CloudWatch custom metrics — minimal code |
| IAM | Per-Lambda least-privilege roles | Each function can only access the resources it needs |
| Shared code | Lambda Layer | Single layer with AWS SDK clients, Powertools, and utility modules |

## DynamoDB Tables

| Table | PK | GSI | Purpose |
|---|---|---|---|
| Orders | `orderId` (S) | `userId-createdAt-index` (PK: `userId`, SK: `createdAt`) | Order records with status tracking |
| Inventory | `productId` (S) | — | Product catalog with stock levels |
| Idempotency | `id` (S) | — | Powertools idempotency cache (TTL on `expiration`) |

## Tech Stack

| Layer | Technology |
|---|---|
| IaC | Terraform (custom reusable modules) |
| Compute | AWS Lambda (Node.js 20.x, ESM) |
| Shared code | Lambda Layer (Powertools + AWS SDK v3 + utilities) |
| Orchestration | AWS Step Functions Express |
| Storage | Amazon DynamoDB (on-demand, PITR enabled) |
| API | Amazon API Gateway (REST) |
| Queue | Amazon SQS + Dead Letter Queue |
| Events | Amazon EventBridge |
| Observability | CloudWatch + X-Ray (via Powertools) |

## Project Structure

```
infrastructure/
  main.tf              # Provider + backend config
  variables.tf         # Input variables (region, env, project name)
  var.tfvars           # Variable values
  dynamodb.tf          # DynamoDB tables (Orders, Inventory, Idempotency)
  sqs.tf               # SQS order queue + DLQ
  lambda.tf            # Lambda functions + SQS event source mapping
  lambda_layer.tf      # Shared dependencies Lambda Layer
  api_gateway.tf       # REST API, routes, JSON Schema validation
  step_functions.tf    # Express state machine (order saga)
  eventbridge.tf       # Custom event bus + event logging
  asl/                 # ASL definitions
  outputs.tf           # Terraform outputs
  iam/                 # Per-Lambda IAM policy modules

backend/
  layers/shared-deps/  # Lambda Layer source
    package.json       # Powertools, AWS SDK clients, @middy/core
    build_layer.sh     # Install deps + zip
    nodejs/lib/        # Utility modules
      dynamodb.mjs     # DynamoDB DocumentClient (Tracer-wrapped)
      sqs.mjs          # SQS client (Tracer-wrapped)
      sfn.mjs          # Step Functions client (Tracer-wrapped)
      eventbridge.mjs  # EventBridge client (Tracer-wrapped)
      response.mjs     # HTTP response helpers (success/error)

  lambdas/orders/
    createOrder/       # POST /orders — validate, write, enqueue
    getOrder/          # GET /orders/{orderId} — read order status
    processOrder/      # SQS consumer — starts Step Functions saga
    replayDlq/         # Drains DLQ → re-sends to main queue

scripts/
  seed_inventory.sh    # Seeds Inventory table with 10 sample products
```

## Getting Started

```bash
# Build the Lambda Layer
cd backend/layers/shared-deps && ./build_layer.sh

# Initialize Terraform
cd infrastructure && terraform init

# Plan (review changes)
terraform plan -var-file=var.tfvars

# Apply
terraform apply -var-file=var.tfvars

# Seed inventory data
cd .. && ./scripts/seed_inventory.sh
```

## Design Documents

- [Build Order](BUILD_ORDER.md) — phased implementation plan with dependency matrix
- [Project Details](project_details.md) — full architecture documentation

## Status

### Phase 1 — Core Foundations ✅
- [x] `.gitignore` and project scaffolding
- [x] Terraform provider config (AWS, eu-west-1, default tags)
- [x] DynamoDB tables (Orders with GSI, Inventory, Idempotency with TTL)
- [x] Lambda Layer (Powertools, AWS SDK, utility modules)
- [x] `createOrder` Lambda (validation, idempotency, DynamoDB write, SQS enqueue)
- [x] Per-Lambda IAM policies
- [x] Seed inventory script (10 products)

### Phase 2 — API Gateway + Queue Layer ✅
- [x] API Gateway REST API (`POST /orders`, `GET /orders/{orderId}`)
- [x] JSON Schema request validation on `POST /orders`
- [x] SQS order queue + DLQ (redrive after 3 failures)
- [x] `processOrder` Lambda (SQS consumer → Step Functions)
- [x] `getOrder` Lambda (order status lookup)
- [x] `replayDlq` Lambda (manual DLQ recovery)
- [x] SQS event source mapping with partial batch failure reporting

### Phase 3 — Saga Orchestration (Step Functions) ✅
- [x] Step Functions Express state machine (ASL)
- [x] `reserveInventory` / `releaseInventory` Lambdas
- [x] `processPayment` / `refundPayment` Lambdas
- [x] `confirmOrder` / `failOrder` Lambdas
- [x] Retry + catch configuration per state
- [x] Payment failure injection (`FAIL_PAYMENT_PERCENT`)

### Phase 4 — Event Publishing (EventBridge) ✅
- [x] Custom event bus (`dev-ser-ord-sys-events`)
- [x] `emitEvent` Lambda (OrderPlaced events via saga)
- [x] EventBridge catch-all event logging to CloudWatch

### Phase 5 — Observability 🔲
- [ ] CloudWatch dashboard
- [ ] Custom alarms (error rates, latency, DLQ depth)
- [ ] X-Ray service map verification

### Phase 6 — Load Testing 🔲
- [ ] k6 test script (10,000+ orders/min target)
- [ ] Performance analysis and tuning
