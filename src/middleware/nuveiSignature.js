
import crypto from 'crypto';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';

const NUVEI_WEBHOOK_SECRET = process.env.NUVEI_WEBHOOK_SECRET || process.env.NUVEI_SHARED_SECRET || process.env.NUVEI_API_KEY;

if (NUVEI_WEBHOOK_SECRET === process.env.NUVEI_API_KEY) {
  logger.warn('Using NUVEI_API_KEY as webhook secret. It is recommended to use a dedicated NUVEI_WEBHOOK_SECRET.');
}

export const verifyNuveiSignature = (req, res, next) => {
  const signature = req.headers['x-nuvei-signature'];
  const timestamp = req.headers['x-nuvei-timestamp'];
  const rawBody = req.body;

  if (!signature || !timestamp) {
    logger.warn('Nuvei webhook missing signature or timestamp');
    return next(new AppError('Webhook signature or timestamp missing', 401));
  }

  // Check if the timestamp is recent (e.g., within 5 minutes)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    logger.warn('Nuvei webhook timestamp too old');
    return next(new AppError('Webhook timestamp too old', 401));
  }

  const concatenatedString = `${timestamp}.${rawBody.toString('utf8')}`;

  const computedSignature = crypto
    .createHmac('sha256', NUVEI_WEBHOOK_SECRET)
    .update(concatenatedString)
    .digest('hex');

  if (computedSignature !== signature) {
    logger.warn('Invalid Nuvei webhook signature');
    return next(new AppError('Invalid webhook signature', 401));
  }

  next();
};
