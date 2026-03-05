# ──────────────────────────────────────────────
# API Gateway REST API
# ──────────────────────────────────────────────

# JSON Schema model for POST /orders request validation
resource "aws_api_gateway_model" "create_order_request" {
  rest_api_id  = module.api_gateway.rest_api_id
  name         = "CreateOrderRequest"
  content_type = "application/json"

  schema = jsonencode({
    "$schema" = "http://json-schema.org/draft-04/schema#"
    type      = "object"
    required  = ["userId", "items", "totalAmount"]
    properties = {
      userId = {
        type      = "string"
        minLength = 1
      }
      items = {
        type     = "array"
        minItems = 1
        items = {
          type     = "object"
          required = ["productId", "qty"]
          properties = {
            productId = { type = "string" }
            qty       = { type = "integer", minimum = 1 }
          }
        }
      }
      totalAmount = {
        type    = "number"
        minimum = 0.01
      }
    }
  })
}

module "api_gateway" {
  source = "git::https://github.com/shaunniee/terraform_modules.git//aws_api_gateway_rest_api?ref=main"

  name        = "${var.env}-${var.project_name}-api"
  description = "Serverless Ordering System REST API"
  stage_name  = var.env

  # X-Ray tracing
  xray_tracing_enabled = true

  # Logging
  access_log_enabled       = true
  create_access_log_group  = true
  access_log_retention_in_days = 14

  # Throttling
  method_settings = {
    logging_level          = "INFO"
    metrics_enabled        = true
    throttling_burst_limit = 200
    throttling_rate_limit  = 100
  }

  # ── Resources ──
  resources = {
    orders = {
      path_part  = "orders"
      parent_key = null
    }
    order_by_id = {
      path_part  = "{orderId}"
      parent_key = "orders"
    }
  }

  # ── Request Validators ──
  request_validators = {
    body_validator = {
      name                  = "validate-request-body"
      validate_request_body = true
    }
  }

  # ── Methods ──
  methods = {
    post_orders = {
      resource_key     = "orders"
      http_method      = "POST"
      request_models   = { "application/json" = aws_api_gateway_model.create_order_request.name }
      request_validator_id = module.api_gateway.request_validator_ids["body_validator"]
    }
    get_order = {
      resource_key = "order_by_id"
      http_method  = "GET"
      request_parameters = {
        "method.request.path.orderId" = true
      }
    }
  }

  # ── Integrations ──
  integrations = {
    post_orders_integration = {
      method_key              = "post_orders"
      type                    = "AWS_PROXY"
      integration_http_method = "POST"
      uri                     = module.create_order_lambda.lambda_function_invoke_arn
    }
    get_order_integration = {
      method_key              = "get_order"
      type                    = "AWS_PROXY"
      integration_http_method = "POST"
      uri                     = module.get_order_lambda.lambda_function_invoke_arn
    }
  }

  # ── CORS Gateway Responses ──
  gateway_responses = {
    default_4xx = {
      response_type = "DEFAULT_4XX"
      response_parameters = {
        "gatewayresponse.header.Access-Control-Allow-Origin"  = "'*'"
        "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type'"
      }
    }
    default_5xx = {
      response_type = "DEFAULT_5XX"
      response_parameters = {
        "gatewayresponse.header.Access-Control-Allow-Origin"  = "'*'"
        "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type'"
      }
    }
  }
}

# ── Lambda Permissions for API Gateway ──

resource "aws_lambda_permission" "apigw_create_order" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = module.create_order_lambda.lambda_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.rest_api_execution_arn}/*/${module.api_gateway.methods_index["post_orders"].http_method}/${join("/", [for r in ["orders"] : r])}"
}

resource "aws_lambda_permission" "apigw_get_order" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = module.get_order_lambda.lambda_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.rest_api_execution_arn}/*/${module.api_gateway.methods_index["get_order"].http_method}/${join("/", [for r in ["orders", "{orderId}"] : r])}"
}
