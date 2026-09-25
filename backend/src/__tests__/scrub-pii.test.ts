import { scrubText, scrubValue } from '../utils/scrubPii';

/** F17 — nothing personal may reach an error report. */
describe('scrubText', () => {
  it.each([
    ['an email', 'Login failed for Priya.S@Example.co.in today', 'priya'],
    ['a mobile number', 'Call +91 9876543210 or 98765 43210? 9876543210', '9876543210'],
    ['a JWT', 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-def_ghi rejected', 'eyJhbGci'],
    ['a bearer header', 'Authorization: Bearer abc.def.ghi', 'abc.def.ghi'],
    ['a reset code', 'password reset code for x → 482913', '482913'],
    ['a Razorpay payment id', 'Refund for pay_Nx8k2LmQ9vRt failed', 'pay_Nx8k2LmQ9vRt'],
  ])('removes %s', (_label, input, secret) => {
    expect(scrubText(input).toLowerCase()).not.toContain(secret.toLowerCase());
  });

  it('removes a mobile number written in the common 5+5 grouping', () => {
    expect(scrubText('call 98765 43210 or 98765-43210')).toBe('call [phone] or [phone]');
  });

  it('keeps ordinary diagnostic text readable', () => {
    expect(scrubText('Cast to ObjectId failed for value "abc" at path "_id"')).toBe(
      'Cast to ObjectId failed for value "abc" at path "_id"',
    );
  });
});

describe('scrubValue', () => {
  it('redacts sensitive keys outright and scrubs text elsewhere, at any depth', () => {
    const scrubbed = scrubValue({
      shippingAddress: { fullName: 'Priya S', line1: '12 MG Road', pincode: '560001', phone: '+919876543210' },
      note: 'customer priya@example.com asked for a refund',
      nested: [{ password: 'Secret123', detail: 'otp 123456' }],
    });

    expect(scrubbed.shippingAddress).toBe('[redacted]');
    expect(scrubbed.note).toBe('customer [email] asked for a refund');
    expect(scrubbed.nested[0].password).toBe('[redacted]');
    expect(scrubbed.nested[0].detail).toBe('otp [6-digit]');
    expect(JSON.stringify(scrubbed)).not.toMatch(/Priya|MG Road|560001|9876543210|Secret123/);
  });
});
