
import { verifyNuveiSignature } from '../../src/middleware/nuveiSignature.js';
import AppError from '../../src/utils/AppError.js';
import crypto from 'crypto';

describe('Nuvei Signature Verification Middleware', () => {
  const secret = 'test-secret';
  process.env.NUVEI_WEBHOOK_SECRET = secret;

  it('should call next() for a valid signature', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ key: 'value' });
    const concatenatedString = `${timestamp}.${body}`;
    const signature = crypto
      .createHmac('sha256', secret)
      .update(concatenatedString)
      .digest('hex');

    const req = {
      headers: {
        'x-nuvei-signature': signature,
        'x-nuvei-timestamp': timestamp,
      },
      body: Buffer.from(body),
    };

    const res = {};
    const next = jest.fn();

    verifyNuveiSignature(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('should return 401 for an invalid signature', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ key: 'value' });

    const req = {
      headers: {
        'x-nuvei-signature': 'invalid-signature',
        'x-nuvei-timestamp': timestamp,
      },
      body: Buffer.from(body),
    };

    const res = {};
    const next = jest.fn();

    verifyNuveiSignature(req, res, next);

    expect(next).toHaveBeenCalledWith(new AppError('Invalid webhook signature', 401));
  });

  it('should return 401 for a missing signature', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ key: 'value' });

    const req = {
      headers: {
        'x-nuvei-timestamp': timestamp,
      },
      body: Buffer.from(body),
    };

    const res = {};
    const next = jest.fn();

    verifyNuveiSignature(req, res, next);

    expect(next).toHaveBeenCalledWith(new AppError('Webhook signature or timestamp missing', 401));
  });

  it('should return 401 for an old timestamp', () => {
    const timestamp = (Math.floor(Date.now() / 1000) - 600).toString();
    const body = JSON.stringify({ key: 'value' });
    const concatenatedString = `${timestamp}.${body}`;
    const signature = crypto
      .createHmac('sha256', secret)
      .update(concatenatedString)
      .digest('hex');

    const req = {
      headers: {
        'x-nuvei-signature': signature,
        'x-nuvei-timestamp': timestamp,
      },
      body: Buffer.from(body),
    };

    const res = {};
    const next = jest.fn();

    verifyNuveiSignature(req, res, next);

    expect(next).toHaveBeenCalledWith(new AppError('Webhook timestamp too old', 401));
  });
});
