variable "orders_table_arn" {
  description = "ARN of the DynamoDB table for orders"
  type        = string
}

variable "idempotency_table_arn" {
  description = "ARN of the DynamoDB table for idempotency"
  type        = string
}


resource "aws_iam_policy" "create_order_lambda_dynamodb_policy" {
  name        = "create_order_lambda_dynamodb_policy"
  description = "IAM policy for Create Order Lambda to access DynamoDB"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem"
        ]
        Resource = var.orders_table_arn
      },
        {
            Effect = "Allow"
            Action = [
            "dynamodb:PutItem",
            "dynamodb:GetItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem"
            ]
            Resource = var.idempotency_table_arn
        }
    ]
  })
}

output "policy_arn" {
  value = aws_iam_policy.create_order_lambda_dynamodb_policy.arn
}