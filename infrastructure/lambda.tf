# ──────────────────────────────────────────────
# createOrder Lambda
# ──────────────────────────────────────────────

# Zip the Lambda code automatically on every apply
data "archive_file" "create_order" {
  type        = "zip"
  source_dir  = "${path.module}/../backend/lambdas/orders/createOrder"
  output_path = "${path.module}/../backend/lambdas/orders/createOrder/createOrder.zip"
}

module "create_order_lambda" {
  source = "git::https://github.com/shaunniee/terraform_modules.git//aws_lambda?ref=main"

  function_name = "${var.project_name}-create-order"
  description   = "Validates and creates orders, then enqueues to SQS for processing"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  timeout       = 10
  memory_size   = 256

  # Deployment package
  filename         = data.archive_file.create_order.output_path
  source_code_hash = data.archive_file.create_order.output_base64sha256

  # Shared Lambda Layer
  layers = [aws_lambda_layer_version.shared_deps.arn]

  # X-Ray tracing
  tracing_mode              = "Active"
  enable_tracing_permissions = true

  # Environment variables
  environment_variables = {
    ORDERS_TABLE       = module.order_table.table_name
    ORDER_QUEUE_URL    = module.order_queue.queue_url
    IDEMPOTENCY_TABLE  = module.idempotency_table.table_name
    POWERTOOLS_SERVICE_NAME = "createOrder"
    POWERTOOLS_METRICS_NAMESPACE = "OrderingSystem"
    POWERTOOLS_LOG_LEVEL = "INFO"
  }

  # Per-Lambda least-privilege IAM (inline policy)
  inline_policies = {
    create_order_policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Sid    = "DynamoDBOrdersWrite"
          Effect = "Allow"
          Action = [
            "dynamodb:PutItem"
          ]
          Resource = module.order_table.table_arn
        },
        {
          Sid    = "DynamoDBIdempotency"
          Effect = "Allow"
          Action = [
            "dynamodb:PutItem",
            "dynamodb:GetItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem"
          ]
          Resource = module.idempotency_table.table_arn
        },
        {
          Sid    = "SQSSendMessage"
          Effect = "Allow"
          Action = [
            "sqs:SendMessage"
          ]
          Resource = module.order_queue.queue_arn
        }
      ]
    })
  }

  # CloudWatch log retention
  log_retention_in_days = 14
}