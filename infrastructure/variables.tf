variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "eu-west-1"
}

variable "env" {
  description = "Environment name used as prefix for all resources"
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "Project name used as prefix for all resources"
  type        = string
  default     = "ser-ord-sys"
}