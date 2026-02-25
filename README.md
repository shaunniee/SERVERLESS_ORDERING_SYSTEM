# Serverless Ordering System

A high-throughput, fault-tolerant ordering system built entirely on AWS serverless services. Designed to handle concurrent orders without overselling inventory, using DynamoDB conditional writes, Step Functions saga orchestration, and Lambda Powertools.

> **Portfolio project** — demonstrates distributed systems design, serverless architecture, IaC, and event-driven patterns.

---

## Architecture

```
Client (Web / Mobile / REST)
        │
  ┌─────┴──────┐
  │            │
AppSync    API Gateway
(GraphQL)   (REST /v1/*)
  │            │
  └─────┬──────┘
        │
   SQS Order Queue ──► DLQ
        │
  Step Functions (Express)
  ┌─────────────────────────────────┐
  │ 1. Validate Input               │
  │ 2. Reserve Inventory (sharded)  │
  │ 3. Process Payment              │
  │ 4. Create Order                 │
  │ 5. Notify User                  │
  │                                 │
  │ Compensation on failure:        │
  │  └─ Refund → Release Inventory  │
  │  └─ Persist to SagaState + SNS  │
  └─────────────────────────────────┘
        │
  ┌─────┴──────────────────┐
  │                        │
DynamoDB (6 tables)    SNS / AppSync
                       Subscriptions
```

## Key Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Inventory consistency | DynamoDB `TransactWriteItems` | All-or-nothing cart reservation; no overselling |
| Inventory scaling | Sharded items in DynamoDB | Distributes concurrent writes across partitions |
| Thundering herd protection | Meta-shard pre-check before transaction | Rejects out-of-stock requests with a cheap read; avoids wasted writes |
| Workflow orchestration | Step Functions Express (Saga) | Automatic compensation on failure; cheaper than Standard for <5 min workflows |
| Idempotency | Lambda Powertools + DynamoDB | Prevents duplicate processing from SQS redelivery or client retries |
| Observability | Lambda Powertools Logger + Tracer | Structured JSON logs, correlation IDs, X-Ray tracing — zero custom code |
| API | Dual: AppSync (GraphQL) + API Gateway (REST) | GraphQL for frontend flexibility; REST for external/legacy consumers |
| Hot partition avoidance | Composite GSI key (`statusMonth`) | `CONFIRMED#2026-02` scatters writes; avoids hot status partitions |
| Reservation expiry | DynamoDB TTL + Stream → compensation Lambda | Auto-releases abandoned reservations; no cron job needed |
| Redis vs DynamoDB | DynamoDB-only | Lower cost, zero ops overhead, strong consistency. Redis can be added later if sub-ms latency is required |

## DynamoDB Tables

| Table | PK | SK | GSI | Purpose |
|---|---|---|---|---|
| Products | `productId` | — | `CategoryIndex(categoryId)` | Product catalog |
| Categories | `categoryId` | — | — | Hierarchical categories (soft delete) |
| Orders | `userId` | `orderId` | `StatusIndex(statusMonth, createdAt)` | Orders + reservation records (TTL + Stream) |
| InventoryShards | `productId` | `shardId` | — | Sharded stock for concurrent writes |
| Idempotency | `id` | — | — | Powertools-managed dedup (TTL) |
| SagaState | `sagaId` | — | — | Failed compensation recovery (TTL) |

## Tech Stack

| Layer | Technology |
|---|---|
| IaC | Terraform (modular, remote-state ready) |
| Compute | AWS Lambda (Node.js 20.x) |
| Shared code | Lambda Layer (Powertools + Zod + AWS SDK v3) |
| Orchestration | AWS Step Functions Express |
| Storage | Amazon DynamoDB (on-demand, encrypted, PITR) |
| GraphQL API | AWS AppSync |
| REST API | Amazon API Gateway |
| Auth | Amazon Cognito (customer + admin groups) |
| Messaging | Amazon SQS (order buffer + DLQ) |
| Notifications | Amazon SNS + AppSync Subscriptions |
| Observability | CloudWatch + X-Ray (via Powertools) |
| Validation | Zod (TypeScript runtime schemas) |

## Project Structure

```
infrastructure/
  main.tf              # Provider + backend
  variables.tf         # Environment config
  var.tfvars           # Variable values
  dynamodb.tf          # All 6 DynamoDB tables

src/
  layers/shared/       # Lambda Layer (Powertools, DynamoDB client, errors, schemas)
    src/
      index.ts         # Barrel export
      logger.ts        # Powertools Logger
      tracer.ts        # Powertools Tracer
      idempotency.ts   # Powertools Idempotency config
      dynamodb.ts      # Shared DocumentClient + table names
      errors.ts        # Typed errors (InventoryError, PaymentError, etc.)
      response.ts      # HTTP response helpers
      schemas/         # Zod validation schemas
    package.json
    tsconfig.json

  lambdas/             # Individual Lambda handlers (coming next)
  step-functions/      # Saga ASL definition (coming next)
```

## Getting Started

```bash
# Install shared layer dependencies
cd src/layers/shared && npm install

# Build the layer
npm run build

# Initialize Terraform
cd infrastructure && terraform init

# Plan (review changes)
terraform plan -var-file=var.tfvars

# Apply
terraform apply -var-file=var.tfvars
```

## Design Documents

- [Implementation Plan](IMPLEMENTATION_PLAN.md) — full architecture, ADRs, phased build order, acceptance criteria
- [Build Order](BUILD_ORDER.md) — dependency-aware 21-step build sequence
- [Original Design](high_throughput_ordering_system.md) — initial system design (V1, pre-review)

## Status

- [x] Architecture design + review
- [x] Implementation plan with ADRs
- [x] Dependency-aware build order
- [x] Terraform foundation (provider, variables)
- [x] DynamoDB tables (6 tables, GSIs, TTL, streams)
- [x] Shared Lambda Layer (Powertools, validation, errors, DynamoDB client)
- [ ] Inventory Lambdas (reserve, compensate, get, admin)
- [ ] Order + Payment Lambdas
- [ ] Catalog + Admin Lambdas
- [ ] Step Functions Saga
- [ ] SQS queue + trigger
- [ ] AppSync API
- [ ] API Gateway REST
- [ ] Security hardening (WAF, IAM audit)
- [ ] Observability (dashboards, alarms)
- [ ] CI/CD pipeline
