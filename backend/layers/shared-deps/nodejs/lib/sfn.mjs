import { SFNClient } from '@aws-sdk/client-sfn';
import { Tracer } from '@aws-lambda-powertools/tracer';

const tracer = new Tracer();
export const sfnClient = tracer.captureAWSv3Client(new SFNClient());
