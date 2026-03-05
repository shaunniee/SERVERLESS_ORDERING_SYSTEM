# ──────────────────────────────────────────────
# Step Functions Express — Order Processing Saga
# ──────────────────────────────────────────────

module "order_saga" {
  source = "git::https://github.com/shaunniee/terraform_modules.git//aws_step_functions?ref=main"

  name = "${var.env}-${var.project_name}-order-saga"
  type = "EXPRESS"

  definition = templatefile("${path.module}/asl/order_saga.asl.json", {
    reserve_inventory_arn = module.reserve_inventory_lambda.lambda_arn
    release_inventory_arn = module.release_inventory_lambda.lambda_arn
    process_payment_arn   = module.process_payment_lambda.lambda_arn
    refund_payment_arn    = module.refund_payment_lambda.lambda_arn
    confirm_order_arn     = module.confirm_order_lambda.lambda_arn
    fail_order_arn        = module.fail_order_lambda.lambda_arn
    emit_event_arn        = module.emit_event_lambda.lambda_arn
  })

  # IAM — allow Step Functions to invoke the saga Lambdas
  inline_policies = {
    invoke_saga_lambdas = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Sid    = "InvokeSagaLambdas"
          Effect = "Allow"
          Action = ["lambda:InvokeFunction"]
          Resource = [
            module.reserve_inventory_lambda.lambda_arn,
            module.release_inventory_lambda.lambda_arn,
            module.process_payment_lambda.lambda_arn,
            module.refund_payment_lambda.lambda_arn,
            module.confirm_order_lambda.lambda_arn,
            module.fail_order_lambda.lambda_arn,
            module.emit_event_lambda.lambda_arn,
          ]
        }
      ]
    })
  }

  # Logging
  create_cloudwatch_log_group = true
  logging_level               = "ALL"
  logging_include_execution_data = true
  log_retention_in_days       = 14

  # Tracing
  tracing_enabled            = true
  enable_tracing_permissions = true
}
