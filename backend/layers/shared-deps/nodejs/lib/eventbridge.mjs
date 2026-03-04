import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { Tracer } from '@aws-lambda-powertools/tracer';

const tracer = new Tracer();
export const ebClient = tracer.captureAWSv3Client(new EventBridgeClient());
