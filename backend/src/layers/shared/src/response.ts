import { APIGatewayProxyResult } from "aws-lambda";
import { AppError } from "./errors";
import { logger } from "./logger";
import { ZodError } from "zod";

/**
 * Standard success response.
 */
export function success(body: unknown, statusCode = 200): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": "true",
    },
    body: JSON.stringify(body),
  };
}

/**
 * Standard error response.
 * Converts known error types to appropriate HTTP status codes.
 */
export function error(err: unknown): APIGatewayProxyResult {
  // Known application errors
  if (err instanceof AppError) {
    logger.warn("Application error", { error: err.toJSON() });
    return {
      statusCode: err.statusCode,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: err.code,
        message: err.message,
        details: err.details,
      }),
    };
  }

  // Zod validation errors
  if (err instanceof ZodError) {
    logger.warn("Validation error", { issues: err.issues });
    return {
      statusCode: 400,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "VALIDATION_ERROR",
        message: "Invalid input",
        details: err.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      }),
    };
  }

  // Unknown errors — don't leak internals
  logger.error("Unhandled error", { error: err });
  return {
    statusCode: 500,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({
      error: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    }),
  };
}
