# ──────────────────────────────────────────────
# EventBridge — Custom Event Bus + Event Logging
# ──────────────────────────────────────────────

# CloudWatch Log Group for OrderPlaced events
resource "aws_cloudwatch_log_group" "order_placed_events" {
  name              = "/aws/events/${var.env}-${var.project_name}/order-placed"
  retention_in_days = 14
}

# Allow EventBridge to write to the log group
resource "aws_cloudwatch_log_resource_policy" "eventbridge_logging" {
  policy_name     = "${var.env}-${var.project_name}-eventbridge-log-policy"
  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EventBridgeToCloudWatchLogs"
        Effect    = "Allow"
        Principal = { Service = "events.amazonaws.com" }
        Action    = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource  = "${aws_cloudwatch_log_group.order_placed_events.arn}:*"
      }
    ]
  })
}

module "event_bus" {
  source = "git::https://github.com/shaunniee/terraform_modules.git//aws_eventbridge?ref=main"

  event_buses = [
    {
      name        = "${var.env}-${var.project_name}-events"
      description = "Order domain events (OrderPlaced, etc.)"

      rules = [
        {
          name        = "order-placed-rule"
          description = "Matches OrderPlaced events from the ordering system"
          event_pattern = jsonencode({
            source      = ["ordering-system"]
            detail-type = ["OrderPlaced"]
          })
          targets = [
            {
              arn                    = aws_cloudwatch_log_group.order_placed_events.arn
              id                     = "order-placed-cw-logs"
              create_lambda_permission = false
            }
          ]
        }
      ]
    }
  ]
}
