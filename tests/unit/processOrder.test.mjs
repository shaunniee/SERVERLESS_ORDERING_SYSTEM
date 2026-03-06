import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SFNClient, StartSyncExecutionCommand } from '@aws-sdk/client-sfn';

const sfnMock = mockClient(SFNClient);

const { handler } = await import('../../backend/lambdas/orders/processOrder/index.mjs');

const context = { functionName: 'test', awsRequestId: 'req-1' };

const makeRecord = (body, messageId = 'msg-1') => ({
  messageId,
  body: JSON.stringify(body),
});

const orderBody = {
  orderId: 'order-001',
  userId: 'user-123',
  items: [{ productId: 'PROD-001', qty: 2 }],
  totalAmount: 59.98,
};

describe('processOrder', () => {
  beforeEach(() => {
    sfnMock.reset();
    sfnMock.resolves({ status: 'SUCCEEDED' });
  });

  it('starts Step Functions execution with orderId as name', async () => {
    await handler({ Records: [makeRecord(orderBody)] }, context);

    const calls = sfnMock.commandCalls(StartSyncExecutionCommand);
    expect(calls).toHaveLength(1);

    const input = calls[0].args[0].input;
    expect(input.stateMachineArn).toBe(
      'arn:aws:states:eu-west-1:123456789012:stateMachine:test-saga'
    );
    expect(input.name).toBe('order-001');
    const parsedInput = JSON.parse(input.input);
    expect(parsedInput.orderId).toBe('order-001');
    expect(parsedInput.items).toEqual([{ productId: 'PROD-001', qty: 2 }]);
  });

  it('returns empty batchItemFailures on success', async () => {
    const result = await handler({ Records: [makeRecord(orderBody)] }, context);

    expect(result.batchItemFailures).toEqual([]);
  });

  it('reports failed message in batchItemFailures on error', async () => {
    sfnMock.on(StartSyncExecutionCommand).rejects(new Error('SFN down'));

    const result = await handler(
      { Records: [makeRecord(orderBody, 'msg-fail')] },
      context
    );

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-fail' },
    ]);
  });

  it('handles multi-record batch with partial failure', async () => {
    const record1 = makeRecord({ ...orderBody, orderId: 'order-001' }, 'msg-1');
    const record2 = makeRecord({ ...orderBody, orderId: 'order-002' }, 'msg-2');

    // First succeeds, second fails
    sfnMock
      .on(StartSyncExecutionCommand, { name: 'order-001' }).resolves({ status: 'SUCCEEDED' })
      .on(StartSyncExecutionCommand, { name: 'order-002' }).rejects(new Error('fail'));

    const result = await handler({ Records: [record1, record2] }, context);

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-2' },
    ]);
  });

  it('handles batch where all messages succeed', async () => {
    const records = [
      makeRecord({ ...orderBody, orderId: 'o1' }, 'msg-1'),
      makeRecord({ ...orderBody, orderId: 'o2' }, 'msg-2'),
      makeRecord({ ...orderBody, orderId: 'o3' }, 'msg-3'),
    ];

    const result = await handler({ Records: records }, context);

    expect(result.batchItemFailures).toEqual([]);
    expect(sfnMock.commandCalls(StartSyncExecutionCommand)).toHaveLength(3);
  });
});
