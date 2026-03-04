
resource "aws_lambda_layer_version" "shared_deps" {
  layer_name          = "${var.env}-${var.project_name}-shared-deps"
  description         = "AWS SDK clients, Lambda Powertools (logger, tracer, metrics, idempotency), shared utilities"
  filename            = "${path.module}/../backend/layers/shared-deps/shared-deps-layer.zip"
  source_code_hash    = filebase64sha256("${path.module}/../backend/layers/shared-deps/shared-deps-layer.zip")
  compatible_runtimes = ["nodejs20.x"]
}
