# ──────────────────────────────────────────────
# Order Processing Queue + Dead-Letter Queue
# ──────────────────────────────────────────────

# DLQ — failed messages land here for investigation
resource "aws_sqs_queue" "order_dlq" {
  name                      = "${var.env}-${var.project_name}-order-dlq"
  message_retention_seconds = 1209600 # 14 days

  tags = {
    Name = "${var.env}-${var.project_name}-order-dlq"
  }
}

# Main order queue — consumed by processOrder Lambda (Phase 2)
resource "aws_sqs_queue" "order_queue" {
  name                       = "${var.env}-${var.project_name}-order-queue"
  visibility_timeout_seconds = 60  # 6× Lambda timeout (10s)
  message_retention_seconds  = 345600 # 4 days
  receive_wait_time_seconds  = 10  # long-polling

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.order_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Name = "${var.env}-${var.project_name}-order-queue"
  }
}
