const { AppError } = require("./errors");
const { logger } = require("./logger");
const { ZodError } = require("zod");

/**
 * Standard success response.
 * @param {unknown} body
 * @param {number} [statusCode=200]
 * @returns {{ statusCode: number, headers: Record<string,string>, body: string }}
 */
function success(body, statusCode = 200) {
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
 * @param {unknown} err
 * @returns {{ statusCode: number, headers: Record<string,string>, body: string }}
 */
function error(err) {
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

module.exports = { success, error };
