import { scrubText, scrubUrl, scrubValue } from '../scrubPii';

/** F17 — nothing personal may reach an error report from the app. */
describe('scrubPii (mobile)', () => {
  it('removes emails, phones, tokens, codes and Razorpay ids from text', () => {
    const scrubbed = scrubText(
      'priya@example.com called 98765 43210 with Bearer abc.def and code 482913 for pay_Nx8k2LmQ9vRt',
    );
    expect(scrubbed).toBe('[email] called [phone] with Bearer [token] and code [6-digit] for [razorpay-id]');
  });

  it('drops the query string from URLs', () => {
    expect(scrubUrl('https://api.example.com/api/v1/admin/users?search=Priya')).toBe(
      'https://api.example.com/api/v1/admin/users',
    );
  });

  it('redacts personal keys at any depth', () => {
    const scrubbed = scrubValue({ order: { shippingAddress: { line1: '12 MG Road' }, note: 'x@y.in' } });
    expect(JSON.stringify(scrubbed)).not.toMatch(/MG Road|x@y\.in/);
  });
});
