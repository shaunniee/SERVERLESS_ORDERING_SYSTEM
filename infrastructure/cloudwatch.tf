# ──────────────────────────────────────────────
# SNS Topic — Alarm Notifications
# ──────────────────────────────────────────────

resource "aws_sns_topic" "alarms" {
  name = "${var.env}-${var.project_name}-alarms"
}

# ──────────────────────────────────────────────
# CloudWatch Dashboard
# ──────────────────────────────────────────────

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.env}-${var.project_name}-dashboard"

  dashboard_body = jsonencode({
    widgets = [

      # ── Row 1: API Gateway ──

      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 8
        height = 6
        properties = {
          title  = "API Requests (Count)"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/ApiGateway", "Count", "ApiName", "${var.env}-${var.project_name}-api", { label = "Total Requests" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 0
        width  = 8
        height = 6
        properties = {
          title  = "API Latency (P50 / P95 / P99)"
          region = var.aws_region
          period = 60
          metrics = [
            ["AWS/ApiGateway", "Latency", "ApiName", "${var.env}-${var.project_name}-api", { stat = "p50", label = "P50" }],
            ["...", { stat = "p95", label = "P95" }],
            ["...", { stat = "p99", label = "P99" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 16
        y      = 0
        width  = 8
        height = 6
        properties = {
          title  = "API Errors (4xx / 5xx)"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/ApiGateway", "4XXError", "ApiName", "${var.env}-${var.project_name}-api", { label = "4xx", color = "#ff9900" }],
            ["AWS/ApiGateway", "5XXError", "ApiName", "${var.env}-${var.project_name}-api", { label = "5xx", color = "#d13212" }]
          ]
        }
      },

      # ── Row 2: Step Functions Saga ──

      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 8
        height = 6
        properties = {
          title  = "Saga Executions (Success / Failed)"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/States", "ExecutionsSucceeded", "StateMachineArn", module.order_saga.state_machine_arn, { label = "Succeeded", color = "#2ca02c" }],
            ["AWS/States", "ExecutionsFailed", "StateMachineArn", module.order_saga.state_machine_arn, { label = "Failed", color = "#d13212" }],
            ["AWS/States", "ExecutionsTimedOut", "StateMachineArn", module.order_saga.state_machine_arn, { label = "Timed Out", color = "#ff9900" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 6
        width  = 8
        height = 6
        properties = {
          title  = "Saga Execution Duration (P50 / P95)"
          region = var.aws_region
          period = 60
          metrics = [
            ["AWS/States", "ExecutionTime", "StateMachineArn", module.order_saga.state_machine_arn, { stat = "p50", label = "P50" }],
            ["...", { stat = "p95", label = "P95" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 16
        y      = 6
        width  = 8
        height = 6
        properties = {
          title  = "Saga Throttled Executions"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/States", "ExecutionThrottled", "StateMachineArn", module.order_saga.state_machine_arn, { label = "Throttled", color = "#ff9900" }]
          ]
        }
      },

      # ── Row 3: SQS Queues ──

      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 8
        height = 6
        properties = {
          title  = "Order Queue — Messages"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/SQS", "NumberOfMessagesSent", "QueueName", module.order_queue.queue_name, { label = "Sent" }],
            ["AWS/SQS", "NumberOfMessagesReceived", "QueueName", module.order_queue.queue_name, { label = "Received" }],
            ["AWS/SQS", "NumberOfMessagesDeleted", "QueueName", module.order_queue.queue_name, { label = "Deleted" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 12
        width  = 8
        height = 6
        properties = {
          title  = "DLQ Depth (Messages Visible)"
          region = var.aws_region
          stat   = "Maximum"
          period = 60
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", module.order_queue.dlq_name, { label = "DLQ Depth", color = "#d13212" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 16
        y      = 12
        width  = 8
        height = 6
        properties = {
          title  = "Order Queue — Age of Oldest Message"
          region = var.aws_region
          stat   = "Maximum"
          period = 60
          metrics = [
            ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", module.order_queue.queue_name, { label = "Age (sec)", color = "#ff9900" }]
          ]
        }
      },

      # ── Row 4: Lambda Duration (Key Functions) ──

      {
        type   = "metric"
        x      = 0
        y      = 18
        width  = 12
        height = 6
        properties = {
          title  = "Lambda Duration P95 — API Functions"
          region = var.aws_region
          period = 60
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", module.create_order_lambda.lambda_function_name, { stat = "p95", label = "createOrder" }],
            ["AWS/Lambda", "Duration", "FunctionName", module.get_order_lambda.lambda_function_name, { stat = "p95", label = "getOrder" }],
            ["AWS/Lambda", "Duration", "FunctionName", module.process_order_lambda.lambda_function_name, { stat = "p95", label = "processOrder" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 18
        width  = 12
        height = 6
        properties = {
          title  = "Lambda Duration P95 — Saga Steps"
          region = var.aws_region
          period = 60
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", module.reserve_inventory_lambda.lambda_function_name, { stat = "p95", label = "reserveInventory" }],
            ["AWS/Lambda", "Duration", "FunctionName", module.process_payment_lambda.lambda_function_name, { stat = "p95", label = "processPayment" }],
            ["AWS/Lambda", "Duration", "FunctionName", module.confirm_order_lambda.lambda_function_name, { stat = "p95", label = "confirmOrder" }],
            ["AWS/Lambda", "Duration", "FunctionName", module.emit_event_lambda.lambda_function_name, { stat = "p95", label = "emitEvent" }]
          ]
        }
      },

      # ── Row 5: Lambda Errors + Concurrent Executions ──

      {
        type   = "metric"
        x      = 0
        y      = 24
        width  = 12
        height = 6
        properties = {
          title  = "Lambda Errors (All Functions)"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/Lambda", "Errors", "FunctionName", module.create_order_lambda.lambda_function_name, { label = "createOrder" }],
            ["AWS/Lambda", "Errors", "FunctionName", module.process_order_lambda.lambda_function_name, { label = "processOrder" }],
            ["AWS/Lambda", "Errors", "FunctionName", module.reserve_inventory_lambda.lambda_function_name, { label = "reserveInventory" }],
            ["AWS/Lambda", "Errors", "FunctionName", module.process_payment_lambda.lambda_function_name, { label = "processPayment" }],
            ["AWS/Lambda", "Errors", "FunctionName", module.confirm_order_lambda.lambda_function_name, { label = "confirmOrder" }],
            ["AWS/Lambda", "Errors", "FunctionName", module.fail_order_lambda.lambda_function_name, { label = "failOrder" }],
            ["AWS/Lambda", "Errors", "FunctionName", module.emit_event_lambda.lambda_function_name, { label = "emitEvent" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 24
        width  = 12
        height = 6
        properties = {
          title  = "Lambda Concurrent Executions"
          region = var.aws_region
          stat   = "Maximum"
          period = 60
          metrics = [
            ["AWS/Lambda", "ConcurrentExecutions", "FunctionName", module.create_order_lambda.lambda_function_name, { label = "createOrder" }],
            ["AWS/Lambda", "ConcurrentExecutions", "FunctionName", module.process_order_lambda.lambda_function_name, { label = "processOrder" }],
            ["AWS/Lambda", "ConcurrentExecutions", "FunctionName", module.reserve_inventory_lambda.lambda_function_name, { label = "reserveInventory" }],
            ["AWS/Lambda", "ConcurrentExecutions", "FunctionName", module.process_payment_lambda.lambda_function_name, { label = "processPayment" }]
          ]
        }
      },

      # ── Row 6: Custom Metrics (Powertools) ──

      {
        type   = "metric"
        x      = 0
        y      = 30
        width  = 12
        height = 6
        properties = {
          title  = "Order Lifecycle (Custom Metrics)"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["OrderingSystem", "OrderCreated", "service", "createOrder", { label = "Created", color = "#2ca02c" }],
            ["OrderingSystem", "OrderConfirmed", "service", "confirmOrder", { label = "Confirmed", color = "#1f77b4" }],
            ["OrderingSystem", "OrderFailed", "service", "failOrder", { label = "Failed", color = "#d13212" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 30
        width  = 12
        height = 6
        properties = {
          title  = "Payment & Inventory (Custom Metrics)"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["OrderingSystem", "PaymentProcessed", "service", "processPayment", { label = "Payment OK", color = "#2ca02c" }],
            ["OrderingSystem", "PaymentFailed", "service", "processPayment", { label = "Payment Failed", color = "#d13212" }],
            ["OrderingSystem", "InventoryReserved", "service", "reserveInventory", { label = "Reserved", color = "#1f77b4" }],
            ["OrderingSystem", "InventoryReleased", "service", "releaseInventory", { label = "Released", color = "#ff9900" }]
          ]
        }
      }
    ]
  })
}


# ──────────────────────────────────────────────
# CloudWatch Alarms
# ──────────────────────────────────────────────

# Alarm: DLQ depth > 10 messages
resource "aws_cloudwatch_metric_alarm" "dlq_depth" {
  alarm_name          = "${var.env}-${var.project_name}-dlq-depth"
  alarm_description   = "DLQ has more than 10 messages — orders are failing repeatedly"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 10
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = module.order_queue.dlq_name
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
}

# Alarm: Saga failure rate > 30% over 5 minutes
resource "aws_cloudwatch_metric_alarm" "saga_failure_rate" {
  alarm_name          = "${var.env}-${var.project_name}-saga-failure-rate"
  alarm_description   = "More than 30% of saga executions are failing"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 30
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "failure_rate"
    expression  = "IF(total > 0, (failed / total) * 100, 0)"
    label       = "Failure Rate %"
    return_data = true
  }

  metric_query {
    id = "failed"
    metric {
      metric_name = "ExecutionsFailed"
      namespace   = "AWS/States"
      period      = 300
      stat        = "Sum"
      dimensions = {
        StateMachineArn = module.order_saga.state_machine_arn
      }
    }
  }

  metric_query {
    id = "total"
    metric {
      metric_name = "ExecutionsStarted"
      namespace   = "AWS/States"
      period      = 300
      stat        = "Sum"
      dimensions = {
        StateMachineArn = module.order_saga.state_machine_arn
      }
    }
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
}

# Alarm: API Gateway 5xx rate > 5% over 5 minutes
resource "aws_cloudwatch_metric_alarm" "api_5xx_rate" {
  alarm_name          = "${var.env}-${var.project_name}-api-5xx-rate"
  alarm_description   = "API 5xx error rate exceeds 5%"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 5
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "error_rate"
    expression  = "IF(total > 0, (errors / total) * 100, 0)"
    label       = "5xx Rate %"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      metric_name = "5XXError"
      namespace   = "AWS/ApiGateway"
      period      = 300
      stat        = "Sum"
      dimensions = {
        ApiName = "${var.env}-${var.project_name}-api"
      }
    }
  }

  metric_query {
    id = "total"
    metric {
      metric_name = "Count"
      namespace   = "AWS/ApiGateway"
      period      = 300
      stat        = "Sum"
      dimensions = {
        ApiName = "${var.env}-${var.project_name}-api"
      }
    }
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
}
