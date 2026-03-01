const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
const { tracer } = require("./tracer");

/**
 * Shared DynamoDB Document Client.
 *
 * - Tracer auto-instruments all SDK calls for X-Ray
 * - marshallOptions: removes undefined values and converts empty strings
 * - unmarshallOptions: unwraps number sets to plain numbers
 *
 * All Lambdas import this instead of creating their own client.
 */
const ddbClient = tracer.captureAWSv3Client(
  new DynamoDBClient({
    region: process.env.AWS_REGION ?? "eu-west-1",
  })
);

const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
  unmarshallOptions: {
    wrapNumbers: false,
  },
});

/**
 * Table names from environment variables.
 * Set via Lambda environment configuration in Terraform.
 */
const TableNames = {
  PRODUCTS: process.env.PRODUCTS_TABLE_NAME ?? "dev-products",
  CATEGORIES: process.env.CATEGORIES_TABLE_NAME ?? "dev-categories",
  ORDERS: process.env.ORDERS_TABLE_NAME ?? "dev-orders",
  INVENTORY_SHARDS:
    process.env.INVENTORY_SHARDS_TABLE_NAME ?? "dev-inventory-shards",
  IDEMPOTENCY: process.env.IDEMPOTENCY_TABLE_NAME ?? "dev-idempotency",
  SAGA_STATE: process.env.SAGA_STATE_TABLE_NAME ?? "dev-saga-state",
};

module.exports = { docClient, TableNames };
