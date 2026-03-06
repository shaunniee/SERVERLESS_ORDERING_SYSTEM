import { SFNClient } from '@aws-sdk/client-sfn';

export const sfnClient = new SFNClient({ region: 'eu-west-1' });
