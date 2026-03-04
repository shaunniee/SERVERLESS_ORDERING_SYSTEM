


module "order_queue" {
    source = "git::https://github.com/shaunniee/terraform_modules.git//aws_sqs?ref=main"
    name = "${var.project_name}-order-queue"
    visibility_timeout_seconds = 60
    message_retention_seconds = 345600
    receive_wait_time_seconds = 10
    create_dlq = true
    max_receive_count = 3
    dlq_message_retention_seconds = 1209600
}