import { EventBridgeClient } from '@aws-sdk/client-eventbridge';

export const ebClient = new EventBridgeClient({ region: 'eu-west-1' });
