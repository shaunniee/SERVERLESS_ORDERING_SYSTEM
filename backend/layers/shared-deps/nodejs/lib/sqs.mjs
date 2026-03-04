import { SQSClient } from '@aws-sdk/client-sqs';
import { Tracer } from '@aws-lambda-powertools/tracer';

const tracer = new Tracer();
export const sqsClient = tracer.captureAWSv3Client(new SQSClient());
