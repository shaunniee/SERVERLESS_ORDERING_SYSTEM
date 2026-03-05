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

  additional_policy_arns = [
    module.create_order_lambda_dynamodb_policy.policy_arn,
    module.create_order_lambda_sqs_policy.policy_arn
  ]

  # CloudWatch log retention
  log_retention_in_days = 14
}



  module "create_order_lambda_dynamodb_policy" {
    source = "./iam/policies/create-order-lambda-policy/dynamodb"
    orders_table_arn = module.order_table.table_arn
    idempotency_table_arn = module.idempotency_table.table_arn
  }

module "create_order_lambda_sqs_policy" {
  source = "./iam/policies/create-order-lambda-policy/sqs"
  sqs_queue_arn = module.order_queue.queue_arn
}


# ──────────────────────────────────────────────
# processOrder Lambda (SQS consumer → Step Functions)
# ──────────────────────────────────────────────

data "archive_file" "process_order" {
  type        = "zip"
  source_dir  = "${path.module}/../backend/lambdas/orders/processOrder"
  output_path = "${path.module}/../backend/lambdas/orders/processOrder/processOrder.zip"
}

module "process_order_lambda" {
  source = "git::https://github.com/shaunniee/terraform_modules.git//aws_lambda?ref=main"

  function_name = "${var.project_name}-process-order"
  description   = "Consumes orders from SQS, starts Step Functions saga execution"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  timeout       = 30
  memory_size   = 256

  filename         = data.archive_file.process_order.output_path
  source_code_hash = data.archive_file.process_order.output_base64sha256

  layers = [aws_lambda_layer_version.shared_deps.arn]

  tracing_mode               = "Active"
  enable_tracing_permissions = true

  environment_variables = {
    STATE_MACHINE_ARN            = module.order_saga.state_machine_arn
    POWERTOOLS_SERVICE_NAME      = "processOrder"
    POWERTOOLS_METRICS_NAMESPACE = "OrderingSystem"
    POWERTOOLS_LOG_LEVEL         = "INFO"
  }

  inline_policies = {
    process_order_policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Sid      = "StepFunctionsStart"
          Effect   = "Allow"
          Action   = ["states:StartSyncExecution"]
          Resource = module.order_saga.state_machine_arn
        },
        {
          Sid      = "SQSConsume"
          Effect   = "Allow"
          Action   = [
            "sqs:ReceiveMessage",
            "sqs:DeleteMessage",
            "sqs:GetQueueAttributes"
          ]
          Resource = module.order_queue.queue_arn
        }
      ]
    })
  }

  log_retention_in_days = 14
}

# SQS → processOrder event source mapping
resource "aws_lambda_event_source_mapping" "sqs_to_process_order" {
  event_source_arn                   = module.order_queue.queue_arn
  function_name                      = module.process_order_lambda.lambda_arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 5
  function_response_types            = ["ReportBatchItemFailures"]
  enabled                            = true
}


# ──────────────────────────────────────────────
# getOrder Lambda (API Gateway → DynamoDB read)
# ──────────────────────────────────────────────

data "archive_file" "get_order" {
  type        = "zip"
  source_dir  = "${path.module}/../backend/lambdas/orders/getOrder"
  output_path = "${path.module}/../backend/lambdas/orders/getOrder/getOrder.zip"
}

module "get_order_lambda" {
  source = "git::https://github.com/shaunniee/terraform_modules.git//aws_lambda?ref=main"

  function_name = "${var.project_name}-get-order"
  description   = "Returns order details by orderId"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  timeout       = 10
  memory_size   = 128

  filename         = data.archive_file.get_order.output_path
  source_code_hash = data.archive_file.get_order.output_base64sha256

  layers = [aws_lambda_layer_version.shared_deps.arn]

  tracing_mode               = "Active"
  enable_tracing_permissions = true

  environment_variables = {
    ORDERS_TABLE                 = module.order_table.table_name
    POWERTOOLS_SERVICE_NAME      = "getOrder"
    POWERTOOLS_METRICS_NAMESPACE = "OrderingSystem"
    POWERTOOLS_LOG_LEVEL         = "INFO"
  }

  inline_policies = {
    get_order_policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Sid      = "DynamoDBRead"
          Effect   = "Allow"
          Action   = ["dynamodb:GetItem", "dynamodb:Query"]
          Resource = [
            module.order_table.table_arn,
            "${module.order_table.table_arn}/index/*"
          ]
        }
      ]
    })
  }

  log_retention_in_days = 14
}


# ──────────────────────────────────────────────
# replayDlq Lambda (drains DLQ → main queue)
# ──────────────────────────────────────────────

data "archive_file" "replay_dlq" {
  type        = "zip"
  source_dir  = "${path.module}/../backend/lambdas/orders/replayDlq"
  output_path = "${path.module}/../backend/lambdas/orders/replayDlq/replayDlq.zip"
}

module "replay_dlq_lambda" {
  source = "git::https://github.com/shaunniee/terraform_modules.git//aws_lambda?ref=main"

  function_name = "${var.project_name}-replay-dlq"
  description   = "Replays failed messages from DLQ back to the main order queue"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  timeout       = 60
  memory_size   = 128

  filename         = data.archive_file.replay_dlq.output_path
  source_code_hash = data.archive_file.replay_dlq.output_base64sha256

  layers = [aws_lambda_layer_version.shared_deps.arn]

  tracing_mode               = "Active"
  enable_tracing_permissions = true

  environment_variables = {
    DLQ_URL                      = module.order_queue.dlq_url
    ORDER_QUEUE_URL              = module.order_queue.queue_url
    POWERTOOLS_SERVICE_NAME      = "replayDlq"
    POWERTOOLS_METRICS_NAMESPACE = "OrderingSystem"
    POWERTOOLS_LOG_LEVEL         = "INFO"
  }

  inline_policies = {
    replay_dlq_policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Sid    = "SQSReadDLQ"
          Effect = "Allow"
          Action = [
            "sqs:ReceiveMessage",
            "sqs:DeleteMessage",
            "sqs:GetQueueAttributes"
          ]
          Resource = module.order_queue.dlq_arn
        },
        {
          Sid      = "SQSSendMainQueue"
          Effect   = "Allow"
          Action   = ["sqs:SendMessage"]
          Resource = module.order_queue.queue_arn
        }
      ]
    })
  }

  log_retention_in_days = 14
}


# ──────────────────────────────────────────────
# reserveInventory Lambda (saga step)
# ──────────────────────────────────────────────

data "archive_file" "reserve_inventory" {
  type        = "zip"
  source_dir  = "${path.module}/../backend/lambdas/orders/reserveInventory"
  output_path = "${path.module}/../backend/lambdas/orders/reserveInventory/reserveInventory.zip"
}

module "reserve_inventory_lambda" {
  source = "git::https://github.com/shaunniee/terraform_modules.git//aws_lambda?ref=main"

  function_name = "${var.project_name}-reserve-inventory"
  description   = "Saga step: atomically decrements inventory stock"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  timeout       = 10
  memory_size   = 128

  filename         = data.archive_file.reserve_inventory.output_path
  source_code_hash = data.archive_file.reserve_inventory.output_base64sha256

  layers = [aws_lambda_layer_version.shared_deps.arn]

  tracing_mode               = "Active"
  enable_tracing_permissions = true

  environment_variables = {
    INVENTORY_TABLE              = module.inventory_table.table_name
    POWERTOOLS_SERVICE_NAME      = "reserveInventory"
    POWERTOOLS_METRICS_NAMESPACE = "OrderingSystem"
    POWERTOOLS_LOG_LEVEL         = "INFO"
  }

  inline_policies = {
    reserve_inventory_policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Sid      = "DynamoDBInventoryUpdate"
          Effect   = "Allow"
          Action   = ["dynamodb:UpdateItem"]
          Resource = module.inventory_table.table_arn
        }
      ]
    })
  }

  log_retention_in_days = 14
}


# ──────────────────────────────────────────────
# releaseInventory Lambda (saga compensation)
# ──────────────────────────────────────────────

data "archive_file" "release_inventory" {
  type        = "zip"
  source_dir  = "${path.module}/../backend/lambdas/orders/releaseInventory"
  output_path = "${path.module}/../backend/lambdas/orders/releaseInventory/releaseInventory.zip"
}

module "release_inventory_lambda" {
  source = "git::https://github.com/shaunniee/terraform_modules.git//aws_lambda?ref=main"

  function_name = "${var.project_name}-release-inventory"
  description   = "Saga compensation: restores inventory stock"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  timeout       = 10
  memory_size   = 128

  filename         = data.archive_file.release_inventory.output_path
  source_code_hash = data.archive_file.release_inventory.output_base64sha256

  layers = [aws_lambda_layer_version.shared_deps.arn]

  tracing_mode               = "Active"
  enable_tracing_permissions = true

  environment_variables = {
    INVENTORY_TABLE              = module.inventory_table.table_name
    POWERTOOLS_SERVICE_NAME      = "releaseInventory"
    POWERTOOLS_METRICS_NAMESPACE = "OrderingSystem"
    POWERTOOLS_LOG_LEVEL         = "INFO"
  }

  inline_policies = {
    release_inventory_policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Sid      = "DynamoDBInventoryUpdate"
          Effect   = "Allow"
          Action   = ["dynamodb:UpdateItem"]
          Resource = module.inventory_table.table_arn
        }
      ]
    })
  }

  log_retention_in_days = 14
}


# ──────────────────────────────────────────────
# processPayment Lambda (saga step)
# ──────────────────────────────────────────────

data "archive_file" "process_payment" {
  type        = "zip"
  source_dir  = "${path.module}/../backend/lambdas/orders/processPayment"
  output_path = "${path.module}/../backend/lambdas/orders/processPayment/processPayment.zip"
}

module "process_payment_lambda" {
  source = "git::https://github.com/shaunniee/terraform_modules.git//aws_lambda?ref=main"

  function_name = "${var.project_name}-process-payment"
  description   = "Saga step: simulates payment processing with configurable failure rate"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  timeout       = 10
  memory_size   = 128

  filename         = data.archive_file.process_payment.output_path
  source_code_hash = data.archive_file.process_payment.output_base64sha256

  layers = [aws_lambda_layer_version.shared_deps.arn]

  tracing_mode               = "Active"
  enable_tracing_permissions = true

  environment_variables = {
    FAIL_PAYMENT_PERCENT         = "20"
    POWERTOOLS_SERVICE_NAME      = "processPayment"
    POWERTOOLS_METRICS_NAMESPACE = "OrderingSystem"
    POWERTOOLS_LOG_LEVEL         = "INFO"
  }

  log_retention_in_days = 14
}


# ──────────────────────────────────────────────
# refundPayment Lambda (saga compensation)
# ──────────────────────────────────────────────

data "archive_file" "refund_payment" {
  type        = "zip"
  source_dir  = "${path.module}/../backend/lambdas/orders/refundPayment"
  output_path = "${path.module}/../backend/lambdas/orders/refundPayment/refundPayment.zip"
}

module "refund_payment_lambda" {
  source = "git::https://github.com/shaunniee/terraform_modules.git//aws_lambda?ref=main"

  function_name = "${var.project_name}-refund-payment"
  description   = "Saga compensation: logs payment refund"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  timeout       = 10
  memory_size   = 128

  filename         = data.archive_file.refund_payment.output_path
  source_code_hash = data.archive_file.refund_payment.output_base64sha256

  layers = [aws_lambda_layer_version.shared_deps.arn]

  tracing_mode               = "Active"
  enable_tracing_permissions = true

  environment_variables = {
    POWERTOOLS_SERVICE_NAME      = "refundPayment"
    POWERTOOLS_METRICS_NAMESPACE = "OrderingSystem"
    POWERTOOLS_LOG_LEVEL         = "INFO"
  }

  log_retention_in_days = 14
}


# ──────────────────────────────────────────────
# confirmOrder Lambda (saga step)
# ──────────────────────────────────────────────

data "archive_file" "confirm_order" {
  type        = "zip"
  source_dir  = "${path.module}/../backend/lambdas/orders/confirmOrder"
  output_path = "${path.module}/../backend/lambdas/orders/confirmOrder/confirmOrder.zip"
}

module "confirm_order_lambda" {
  source = "git::https://github.com/shaunniee/terraform_modules.git//aws_lambda?ref=main"

  function_name = "${var.project_name}-confirm-order"
  description   = "Saga step: updates order status to CONFIRMED"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  timeout       = 10
  memory_size   = 128

  filename         = data.archive_file.confirm_order.output_path
  source_code_hash = data.archive_file.confirm_order.output_base64sha256

  layers = [aws_lambda_layer_version.shared_deps.arn]

  tracing_mode               = "Active"
  enable_tracing_permissions = true

  environment_variables = {
    ORDERS_TABLE                 = module.order_table.table_name
    POWERTOOLS_SERVICE_NAME      = "confirmOrder"
    POWERTOOLS_METRICS_NAMESPACE = "OrderingSystem"
    POWERTOOLS_LOG_LEVEL         = "INFO"
  }

  inline_policies = {
    confirm_order_policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Sid      = "DynamoDBOrdersUpdate"
          Effect   = "Allow"
          Action   = ["dynamodb:UpdateItem"]
          Resource = module.order_table.table_arn
        }
      ]
    })
  }

  log_retention_in_days = 14
}


# ──────────────────────────────────────────────
# failOrder Lambda (saga terminal state)
# ──────────────────────────────────────────────

data "archive_file" "fail_order" {
  type        = "zip"
  source_dir  = "${path.module}/../backend/lambdas/orders/failOrder"
  output_path = "${path.module}/../backend/lambdas/orders/failOrder/failOrder.zip"
}

module "fail_order_lambda" {
  source = "git::https://github.com/shaunniee/terraform_modules.git//aws_lambda?ref=main"

  function_name = "${var.project_name}-fail-order"
  description   = "Saga terminal: updates order status to FAILED with reason"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  timeout       = 10
  memory_size   = 128

  filename         = data.archive_file.fail_order.output_path
  source_code_hash = data.archive_file.fail_order.output_base64sha256

  layers = [aws_lambda_layer_version.shared_deps.arn]

  tracing_mode               = "Active"
  enable_tracing_permissions = true

  environment_variables = {
    ORDERS_TABLE                 = module.order_table.table_name
    POWERTOOLS_SERVICE_NAME      = "failOrder"
    POWERTOOLS_METRICS_NAMESPACE = "OrderingSystem"
    POWERTOOLS_LOG_LEVEL         = "INFO"
  }

  inline_policies = {
    fail_order_policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Sid      = "DynamoDBOrdersUpdate"
          Effect   = "Allow"
          Action   = ["dynamodb:UpdateItem"]
          Resource = module.order_table.table_arn
        }
      ]
    })
  }

  log_retention_in_days = 14
}


# ──────────────────────────────────────────────
# emitEvent Lambda (saga step — EventBridge publisher)
# ──────────────────────────────────────────────

data "archive_file" "emit_event" {
  type        = "zip"
  source_dir  = "${path.module}/../backend/lambdas/orders/emitEvent"
  output_path = "${path.module}/../backend/lambdas/orders/emitEvent/emitEvent.zip"
}

module "emit_event_lambda" {
  source = "git::https://github.com/shaunniee/terraform_modules.git//aws_lambda?ref=main"

  function_name = "${var.project_name}-emit-event"
  description   = "Saga step: publishes OrderPlaced event to EventBridge"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  timeout       = 10
  memory_size   = 128

  filename         = data.archive_file.emit_event.output_path
  source_code_hash = data.archive_file.emit_event.output_base64sha256

  layers = [aws_lambda_layer_version.shared_deps.arn]

  tracing_mode               = "Active"
  enable_tracing_permissions = true

  environment_variables = {
    EVENT_BUS_NAME               = module.event_bus.event_bus_names["${var.env}-${var.project_name}-events"]
    POWERTOOLS_SERVICE_NAME      = "emitEvent"
    POWERTOOLS_METRICS_NAMESPACE = "OrderingSystem"
    POWERTOOLS_LOG_LEVEL         = "INFO"
  }

  inline_policies = {
    emit_event_policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Sid      = "EventBridgePutEvents"
          Effect   = "Allow"
          Action   = ["events:PutEvents"]
          Resource = module.event_bus.event_bus_arns["${var.env}-${var.project_name}-events"]
        }
      ]
    })
  }

  log_retention_in_days = 14
}