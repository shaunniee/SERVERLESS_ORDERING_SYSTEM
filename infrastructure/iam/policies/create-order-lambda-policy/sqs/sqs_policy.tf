variable "sqs_queue_arn" {
  description = "ARN of the SQS queue for orders"
  type        = string
}



resource "aws_iam_policy" "create_order_lambda_sqs_policy" {
  name        = "create_order_lambda_sqs_policy"
  description = "IAM policy for Create Order Lambda to access SQS"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage"
        ]
        Resource = var.sqs_queue_arn
      }
    ]
  })
}

output "policy_arn" {
  value = aws_iam_policy.create_order_lambda_sqs_policy.arn
}