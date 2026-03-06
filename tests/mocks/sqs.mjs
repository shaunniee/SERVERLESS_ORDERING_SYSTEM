import { SQSClient } from '@aws-sdk/client-sqs';

export const sqsClient = new SQSClient({ region: 'eu-west-1' });
