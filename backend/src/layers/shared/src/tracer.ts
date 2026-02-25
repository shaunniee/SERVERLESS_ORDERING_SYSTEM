import { Tracer } from "@aws-lambda-powertools/tracer";

/**
 * Shared Tracer instance.
 *
 * Automatically instruments AWS SDK v3 calls and creates subsegments.
 * Each Lambda handler should call `tracer.getSegment()` or use the
 * `captureLambdaHandler` middleware for automatic context.
 *
 * Set POWERTOOLS_TRACER_CAPTURE_RESPONSE=true and
 * POWERTOOLS_TRACER_CAPTURE_ERROR=true via Lambda env vars.
 */
export const tracer = new Tracer({
  serviceName: process.env.SERVICE_NAME ?? "ordering-system",
  captureHTTPsRequests: true,
});
