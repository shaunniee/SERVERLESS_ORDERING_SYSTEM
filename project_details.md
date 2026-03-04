# High-Scale Event-Driven Order Processing System
## Saga-Based Distributed Architecture (Terraform + AWS)

---

# Project Overview

This project is a production-style, event-driven backend capable of processing 10,000+ orders per minute using the Saga pattern for distributed transaction management.

The system simulates a real-world e-commerce order pipeline with:

- Order ingestion
- Inventory reservation
- Payment processing
- Order confirmation
- Failure compensation
- Event publishing
- Observability and load testing

All infrastructure is provisioned using Terraform.

---

# Architecture Overview

## Core Services

- Amazon API Gateway – Order ingestion layer  
- Amazon SQS – Traffic buffering and back-pressure control  
- AWS Lambda – Business logic execution  
- AWS Step Functions – Saga orchestration  
- Amazon DynamoDB – Orders, inventory, and idempotency storage  
- Amazon EventBridge – Domain event distribution  
- Amazon CloudWatch – Metrics, logs, dashboards  
- AWS X-Ray – Distributed tracing  

---

# End-to-End Order Flow

1. Client sends POST /orders
2. API Lambda:
   - Validates request
   - Powertools Idempotency checks for duplicate request (hashes request body)
   - If duplicate: returns cached response immediately
   - If new: performs idempotent write to Orders table
   - Sends message to SQS
3. SQS triggers Processor Lambda
4. Processor starts Step Functions execution
5. Saga workflow executes:
   - Reserve inventory
   - Process payment
   - Confirm order
   - Emit OrderPlaced event
6. If any step fails:
   - Compensating actions execute
   - Order marked FAILED

---

# Saga Pattern Implementation

Traditional database transactions do not work across distributed services.

Instead, we use a Saga:
- Each step performs a local transaction
- On failure, compensating steps undo prior actions

## State Machine Structure

ReserveInventory  
→ ProcessPayment  
→ ConfirmOrder  
→ EmitEvent  

Each state includes:
- Retry policy with exponential backoff
- Catch block for compensation
- Timeout configuration
- Explicit failure transitions

### Compensation Examples

If payment fails:
- Release inventory
- Mark order as FAILED

If inventory reservation fails:
- Immediately fail saga

---

# Data Model

## Orders Table

| Attribute     | Description |
|--------------|------------|
| orderId (PK) | Unique order identifier |
| userId       | Customer ID |
| status       | PENDING / CONFIRMED / FAILED |
| totalAmount  | Order value |
| createdAt    | Timestamp |

### Idempotency

Two layers of protection against duplicate orders:

**Layer 1 — Powertools Idempotency (request-level)**

Uses `@aws-lambda-powertools/idempotency` with a DynamoDB-backed persistence store.
Hashes the full request body — if the same payload arrives within 1 hour (TTL),
returns the cached response without re-executing the handler.

**Layer 2 — Conditional Write (record-level)**

ConditionExpression:
attribute_not_exists(orderId)

Prevents duplicate orders if the same orderId is generated (belt-and-suspenders).

---

## Inventory Table

| Attribute        | Description |
|------------------|------------|
| productId (PK)   | Product ID |
| stock            | Available quantity |

### Safe Reservation Logic

UpdateExpression:
SET stock = stock - :qty

ConditionExpression:
stock >= :qty

Prevents overselling under high concurrency.

---

# Infrastructure as Code (Terraform)

## Directory Structure

/terraform  
  /modules  
    api  
    lambda  
    sqs  
    dynamodb  
    stepfunctions  
    eventbridge  
    iam  
  main.tf  
  variables.tf  
  outputs.tf  
  backend.tf  

## Backend Configuration

- Remote state stored in S3
- DynamoDB state locking
- Separate environments (dev / loadtest)

---

# Scalability Design

Target: 10,000 orders per minute (~167/sec)

Concurrency formula:

Concurrency = RequestsPerSecond × AvgExecutionTimeSeconds

Example:

If processing takes 0.5 seconds:

167 × 0.5 = ~84 concurrent executions

Reserved concurrency is configured to protect the account.

SQS acts as a buffer to absorb traffic spikes.

---

# Load Testing Strategy

Tool: k6

Test profile:
- Sustained 10k orders/min for 10 minutes
- Measure:
  - Success rate
  - P95 latency
  - DLQ depth
  - Saga compensation rate

Graphs and metrics included in repository.

---

# Reliability Features

## Idempotency
- Powertools Idempotency with DynamoDB persistence store
- Request body hashed as idempotency key
- 1-hour TTL with automatic DynamoDB cleanup
- Conditional writes as secondary protection
- Safe client retries
- No duplicate orders

## Idempotency Table

| Attribute        | Description |
|------------------|------------|
| id (PK)          | Hash of the request body |
| expiration       | TTL timestamp (auto-deleted by DynamoDB) |
| status           | INPROGRESS / COMPLETED / EXPIRED |
| data             | Cached Lambda response |
| validation       | Payload hash for integrity check |

## Retry + Backoff
- Configured in Step Functions
- Handles transient downstream failures

## Dead Letter Queue
- Attached to SQS
- Failed messages stored for replay
- Replay Lambda implemented

## Failure Injection

Environment variable:
FAIL_PAYMENT_PERCENT=20

Simulates real-world payment instability.

---

# Observability

## Metrics Tracked

- Orders per second
- Saga success rate
- Compensation rate
- DLQ message count
- Processing latency (P95)

## Logging

- Structured JSON logs
- Correlation ID per order
- Centralized in CloudWatch

## Tracing

- End-to-end trace visibility
- Debug distributed failures quickly

---

# Build Order

## Phase 1 – Core Foundations
- Terraform backend setup
- DynamoDB tables
- Order creation Lambda
- Idempotent write validation

## Phase 2 – Queue Layer
- SQS + DLQ
- Processor Lambda
- Failure simulation

## Phase 3 – Saga Orchestration
- Step Functions state machine
- Compensation logic
- Retry policies

## Phase 4 – Eventing
- EventBridge integration
- Publish OrderPlaced events
- Add sample consumer

## Phase 5 – Observability
- Enable tracing
- Create dashboards
- Structured logging

## Phase 6 – Load Testing
- Configure concurrency
- Execute sustained traffic test
- Capture performance metrics

---

# What This Project Demonstrates

- Distributed transaction management
- Event-driven architecture
- Back-pressure control
- Concurrency handling
- Data consistency under failure
- Infrastructure as Code discipline
- Production-grade observability
- Performance validation through load testing

---

# Cost Considerations

For a 10-minute 10k/min load test:

Estimated cost: $2–$10

Includes:
- API requests
- Lambda executions
- DynamoDB writes
- SQS operations
- Logging and tracing

---

# Future Enhancements

- Multi-region failover simulation
- Circuit breaker for payment step
- FIFO queue comparison
- Exactly-once payment ledger
- Express vs Standard workflow comparison

---

# Summary

This project mirrors production-grade distributed architecture.

Built with:
- Event-driven design
- Saga orchestration
- Terraform-based infrastructure
- Observability-first mindset
- Proven scalability through load testing