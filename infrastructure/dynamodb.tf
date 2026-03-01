# Products Table

module "products_table" {
  source       = "git::https://github.com/shaunniee/terraform_modules.git//aws_dynamodb?ref=main"
  table_name   = "${var.project_name}-products"
  hash_key    = "productId"
  billing_mode = "PAY_PER_REQUEST"
    attributes   = [
    {
      name = "productId"
      type = "S"
    },
    {
        name ="categoryId"
        type = "S"
    }
  ]

  global_secondary_indexes = [
    {
      name            = "categoryIndex"
      hash_key        = "categoryId"
      projection_type = "ALL"
    }
  ]

  server_side_encryption = {
    enabled = true
    kms_key_arn = null
  }

}

# Categories Table
module "categories_table" {
  source       = "git::https://github.com/shaunniee/terraform_modules.git//aws_dynamodb?ref=main"
  table_name   = "${var.project_name}-categories"
  hash_key    = "categoryId"
  billing_mode = "PAY_PER_REQUEST"
    attributes   = [
    {
      name = "categoryId"
      type = "S"
    }
  ]

  server_side_encryption = {
    enabled = true
    kms_key_arn = null
  }

}

#orders table
module "orders_table" {
  source       = "git::https://github.com/shaunniee/terraform_modules.git//aws_dynamodb?ref=main"
    table_name   = "${var.project_name}-orders"
    hash_key    = "userId"
    range_key   = "orderId"
    billing_mode = "PAY_PER_REQUEST"
    attributes   = [
    {
      name = "orderId"
      type = "S"
    },
    {
        name ="userId"
        type = "S"
    },
    {
        name ="status"
        type = "S"
    },
    {
        name ="statusMonth"
        type = "S"
    },
    {
        name ="createdAt"
        type = "S"
    },
    {
        name ="expiresAt"
        type = "N"
    }
  ]

  global_secondary_indexes = [
    {
      name            = "statusIndex"
      hash_key        = "statusMonth"
      range_key       = "createdAt"
      projection_type = "ALL"
    }
  ]
  ttl={
    enabled = true
    attribute_name = "expiresAt"
  }

  server_side_encryption = {
    enabled = true
    kms_key_arn = null
  }
  stream_enabled = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

}
# Inventory table shards

module "inventoryShards" {
  source       = "git::https://github.com/shaunniee/terraform_modules.git//aws_dynamodb?ref=main"
    table_name   = "${var.project_name}-inventory-shards"
  hash_key    = "productId"
  billing_mode = "PAY_PER_REQUEST"
  range_key   = "shardId"
  attributes   = [
    {
      name = "productId"
      type = "S"
    },
    {
        name ="shardId"
        type = "N"
    }
  ]
    server_side_encryption = {
        enabled = true
        kms_key_arn = null
    }
}

# ProductView table — denormalized read model built on product creation
# Stores product data enriched with categoryName so reads avoid cross-table lookups

module "product_view_table" {
  source       = "git::https://github.com/shaunniee/terraform_modules.git//aws_dynamodb?ref=main"
  table_name   = "${var.project_name}-product-views"
  hash_key     = "productId"
  billing_mode = "PAY_PER_REQUEST"
  attributes = [
    {
      name = "productId"
      type = "S"
    },
    {
      name = "categoryId"
      type = "S"
    },
    {
      name = "createdAt"
      type = "S"
    }
  ]

  global_secondary_indexes = [
    {
      name            = "categoryIndex"
      hash_key        = "categoryId"
      range_key       = "createdAt"
      projection_type = "ALL"
    }
  ]

  server_side_encryption = {
    enabled = true
    kms_key_arn = null
  }
}

# Idempotency table

module "idempotency_table" {
  source       = "git::https://github.com/shaunniee/terraform_modules.git//aws_dynamodb?ref=main"
    table_name   = "${var.project_name}-idempotency"
  hash_key    = "id"
    billing_mode = "PAY_PER_REQUEST"
    attributes   = [
        {
        name = "id"
        type = "S"
        }
    ]
    ttl={
        enabled = true
    }
    server_side_encryption = {
        enabled = true
        kms_key_arn = null
    }
}

# Saga State table

module "saga_state_table" {
  source       = "git::https://github.com/shaunniee/terraform_modules.git//aws_dynamodb?ref=main"
    table_name   = "${var.project_name}-saga-state"
  hash_key    = "sagaId"
    billing_mode = "PAY_PER_REQUEST"
    attributes   = [
        {
        name = "sagaId"
        type = "S"
        },
        {
        name = "expiresAt"
        type = "N"
        }
    ]
    ttl={
        enabled = true
        attribute_name = "expiresAt"
    }
    server_side_encryption = {
        enabled = true
        kms_key_arn = null
    }
}