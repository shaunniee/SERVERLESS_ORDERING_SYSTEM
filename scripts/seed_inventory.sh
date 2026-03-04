#!/usr/bin/env bash
# ──────────────────────────────────────────────────
# Seed the Inventory DynamoDB table with sample data
# Usage: ./scripts/seed_inventory.sh [table-name]
# ──────────────────────────────────────────────────
set -euo pipefail

TABLE_NAME="${1:-ser-ord-sys-inventory-table}"
REGION="${AWS_REGION:-eu-west-1}"

echo "Seeding table: $TABLE_NAME (region: $REGION)"
echo "────────────────────────────────────────────"

items='[
  {
    "productId": {"S": "PROD-001"},
    "name":      {"S": "Wireless Mouse"},
    "price":     {"N": "29.99"},
    "stock":     {"N": "500"},
    "category":  {"S": "Electronics"},
    "createdAt": {"S": "2026-01-01T00:00:00Z"}
  },
  {
    "productId": {"S": "PROD-002"},
    "name":      {"S": "Mechanical Keyboard"},
    "price":     {"N": "89.99"},
    "stock":     {"N": "300"},
    "category":  {"S": "Electronics"},
    "createdAt": {"S": "2026-01-01T00:00:00Z"}
  },
  {
    "productId": {"S": "PROD-003"},
    "name":      {"S": "USB-C Hub"},
    "price":     {"N": "49.99"},
    "stock":     {"N": "200"},
    "category":  {"S": "Electronics"},
    "createdAt": {"S": "2026-01-01T00:00:00Z"}
  },
  {
    "productId": {"S": "PROD-004"},
    "name":      {"S": "Laptop Stand"},
    "price":     {"N": "39.99"},
    "stock":     {"N": "150"},
    "category":  {"S": "Accessories"},
    "createdAt": {"S": "2026-01-01T00:00:00Z"}
  },
  {
    "productId": {"S": "PROD-005"},
    "name":      {"S": "Noise-Cancelling Headphones"},
    "price":     {"N": "199.99"},
    "stock":     {"N": "100"},
    "category":  {"S": "Audio"},
    "createdAt": {"S": "2026-01-01T00:00:00Z"}
  },
  {
    "productId": {"S": "PROD-006"},
    "name":      {"S": "Webcam HD 1080p"},
    "price":     {"N": "59.99"},
    "stock":     {"N": "250"},
    "category":  {"S": "Electronics"},
    "createdAt": {"S": "2026-01-01T00:00:00Z"}
  },
  {
    "productId": {"S": "PROD-007"},
    "name":      {"S": "Monitor Arm"},
    "price":     {"N": "44.99"},
    "stock":     {"N": "120"},
    "category":  {"S": "Accessories"},
    "createdAt": {"S": "2026-01-01T00:00:00Z"}
  },
  {
    "productId": {"S": "PROD-008"},
    "name":      {"S": "Desk Pad XL"},
    "price":     {"N": "24.99"},
    "stock":     {"N": "400"},
    "category":  {"S": "Accessories"},
    "createdAt": {"S": "2026-01-01T00:00:00Z"}
  },
  {
    "productId": {"S": "PROD-009"},
    "name":      {"S": "Portable SSD 1TB"},
    "price":     {"N": "109.99"},
    "stock":     {"N": "80"},
    "category":  {"S": "Storage"},
    "createdAt": {"S": "2026-01-01T00:00:00Z"}
  },
  {
    "productId": {"S": "PROD-010"},
    "name":      {"S": "Bluetooth Speaker"},
    "price":     {"N": "34.99"},
    "stock":     {"N": "350"},
    "category":  {"S": "Audio"},
    "createdAt": {"S": "2026-01-01T00:00:00Z"}
  }
]'

# Use batch-write-item (max 25 items per batch — we have 10, so one call)
# Build the batch request
put_requests=""
count=0

for row in $(echo "$items" | jq -c '.[]'); do
  put_requests+="{ \"PutRequest\": { \"Item\": $row } },"
  count=$((count + 1))
done

# Strip trailing comma
put_requests="${put_requests%,}"

batch_payload="{\"$TABLE_NAME\": [$put_requests]}"

echo "Writing $count items..."

aws dynamodb batch-write-item \
  --region "$REGION" \
  --request-items "$batch_payload"

echo "────────────────────────────────────────────"
echo "✓ Successfully seeded $count products into $TABLE_NAME"

# Quick verification
item_count=$(aws dynamodb scan \
  --region "$REGION" \
  --table-name "$TABLE_NAME" \
  --select "COUNT" \
  --query "Count" \
  --output text)

echo "✓ Table now contains $item_count items"
