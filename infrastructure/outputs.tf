output "orders_table_arn" {
  value = module.order_table.table_arn
}

output "idempotency_table_arn" {
  value = module.idempotency_table.table_arn
}

output "order_queue_arn" {
  value = module.order_queue.queue_arn
}

output "create_order_lambda_invoke_arn" {
    value = module.create_order_lambda.lambda_function_invoke_arn
}