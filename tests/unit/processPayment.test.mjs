import { describe, it, expect, beforeEach, vi } from 'vitest';

const baseEvent = {
  orderId: 'order-001',
  userId: 'user-123',
  totalAmount: 59.98,
};

describe('processPayment', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('succeeds when FAIL_PAYMENT_PERCENT is 0', async () => {
    // FAIL_PAYMENT_PERCENT is set to '0' in setup.mjs
    const { handler } = await import('../../backend/lambdas/orders/processPayment/index.mjs');
    const result = await handler(baseEvent);

    expect(result.paymentStatus).toBe('SUCCEEDED');
    expect(result.orderId).toBe('order-001');
    expect(result.userId).toBe('user-123');
  });

  it('returns event with paymentStatus SUCCEEDED', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // 99 > 0 → success
    const { handler } = await import('../../backend/lambdas/orders/processPayment/index.mjs');

    const result = await handler(baseEvent);
    expect(result.paymentStatus).toBe('SUCCEEDED');
    expect(result.totalAmount).toBe(59.98);
  });

  it('throws "Payment declined" when random falls below FAIL_PAYMENT_PERCENT', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.001); // 0.1 < 50 → fail

    // Reset module cache and re-import with high failure rate
    vi.resetModules();
    const origPercent = process.env.FAIL_PAYMENT_PERCENT;
    process.env.FAIL_PAYMENT_PERCENT = '50';

    const mod = await import('../../backend/lambdas/orders/processPayment/index.mjs');
    process.env.FAIL_PAYMENT_PERCENT = origPercent;

    await expect(mod.handler(baseEvent)).rejects.toThrow('Payment declined');
  });
});
