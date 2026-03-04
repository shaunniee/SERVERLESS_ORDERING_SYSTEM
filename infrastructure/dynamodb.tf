# Order table

module "order_table" {
  source = "git::https://github.com/shaunniee/terraform_modules.git//aws_dynamodb?ref=main"
  table_name = "${var.project_name}-orders-table"
  billing_mode = "PAY_PER_REQUEST"
  hash_key = "orderId"
  point_in_time_recovery_enabled = true

  attributes = [
    {
      name = "orderId"
      type = "S"
    },
    {
        name = "createdAt"
        type = "S"
    },
    {
        name = "userId"
        type = "S"
    }
  ]

  global_secondary_indexes = [
    {
      name = "userId-createdAt-index"
      hash_key = "userId"
      range_key = "createdAt"
      projection_type = "ALL"
    }
  ]

 
}


# Inventory Table

module "inventory_table" {
  source = "git::https://github.com/shaunniee/terraform_modules.git//aws_dynamodb?ref=main"
  table_name = "${var.project_name}-inventory-table"
  billing_mode = "PAY_PER_REQUEST"
  hash_key = "productId"
  point_in_time_recovery_enabled = true

  attributes = [
    {
      name = "productId"
      type = "S"
    }
  ]
}

module "idempotency_table" {
  source     = "git::https://github.com/shaunniee/terraform_modules.git//aws_dynamodb?ref=main"
  table_name = "${var.project_name}-idempotency-table"
  billing_mode = "PAY_PER_REQUEST"
  hash_key   = "id"

  attributes = [
    { name = "id", type = "S" }
  ]

  ttl = {
    attribute_name = "expiration"
    enabled        = true
  }
}