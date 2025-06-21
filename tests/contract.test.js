import mongoose from 'mongoose';
import { testUsers, testGig, createToken, request, app } from './setup.js';
import User from '../src/models/User.js';
import Contract from '../src/models/Contract.js';
import { Gig } from '../src/models/Gig.js';
import Payment from '../src/models/Payment.js';

describe('Contract API', () => {
  let provider, tasker, providerToken, taskerToken, contract, gig;

  beforeEach(async () => {
    await User.deleteMany({});
    await Gig.deleteMany({});
    await Contract.deleteMany({});
    
    provider = await User.create(testUsers.provider);
    tasker = await User.create(testUsers.tasker);
    
    providerToken = createToken(provider._id);
    taskerToken = createToken(tasker._id);

    gig = await Gig.create({
      ...testGig,
      postedBy: provider._id
    });

    contract = await Contract.create({
      gig: gig._id,
      provider: provider._id,
      tasker: tasker._id,
      status: 'active',
      amount: 100.00,
      agreedCost: 100.00,
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
    });
  });

  describe('GET /api/v1/contracts/my-contracts', () => {
    it('should get contracts for provider', async () => {
      const res = await request(app)
        .get('/api/v1/contracts/my-contracts')
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data.contracts)).toBe(true);
    });

    it('should get contracts for tasker', async () => {
      const res = await request(app)
        .get('/api/v1/contracts/my-contracts')
        .set('Authorization', `Bearer ${taskerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data.contracts)).toBe(true);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/v1/contracts/my-contracts');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/contracts', () => {
    it('should get contract by gig ID', async () => {
      const gigId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .get(`/api/v1/contracts?gigId=${gigId}`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should return 400 for missing gig ID', async () => {
      const res = await request(app)
        .get('/api/v1/contracts')
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/v1/contracts?gigId=507f1f77bcf86cd799439011');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/contracts/:id', () => {
    it('should get a specific contract', async () => {
      const res = await request(app)
        .get(`/api/v1/contracts/${contract._id}`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.contract).toHaveProperty('_id', contract._id.toString());
    });

    it('should return 404 for non-existent contract', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .get(`/api/v1/contracts/${fakeId}`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get(`/api/v1/contracts/${contract._id}`);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('PATCH /api/v1/contracts/:id/submit-work', () => {
    it('should submit work successfully', async () => {
      const res = await request(app)
        .patch(`/api/v1/contracts/${contract._id}/submit-work`)
        .set('Authorization', `Bearer ${taskerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should return 403 for non-tasker users', async () => {
      const res = await request(app)
        .patch(`/api/v1/contracts/${contract._id}/submit-work`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(403);
    });

    it('should return 404 for non-existent contract', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .patch(`/api/v1/contracts/${fakeId}/submit-work`)
        .set('Authorization', `Bearer ${taskerToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).patch(`/api/v1/contracts/${contract._id}/submit-work`);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('PATCH /api/v1/contracts/:id/approve-completion', () => {
    it('should approve completion successfully', async () => {
      // Simulate contract status and payment state for approval
      contract.status = 'submitted';
      await contract.save();
      // Mock a successful payment for this contract
      await Payment.create({
        contract: contract._id,
        gig: gig._id,
        payer: provider._id,
        payee: tasker._id,
        amount: 10000, // $100.00 in cents
        currency: 'cad',
        applicationFeeAmount: 500, // $5.00 in cents
        amountReceivedByPayee: 9500, // $95.00 in cents (after platform fee)
        status: 'succeeded',
        paymentMethodType: 'test',
        stripeConnectedAccountId: 'acct_test',
        taxAmount: 1300, // $13.00 in cents (13% tax)
        amountAfterTax: 8700 // $87.00 in cents (after tax)
      });
      const res = await request(app)
        .patch(`/api/v1/contracts/${contract._id}/approve-completion`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should return 403 for non-provider users', async () => {
      const res = await request(app)
        .patch(`/api/v1/contracts/${contract._id}/approve-completion`)
        .set('Authorization', `Bearer ${taskerToken}`);

      expect(res.statusCode).toBe(403);
    });

    it('should return 404 for non-existent contract', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .patch(`/api/v1/contracts/${fakeId}/approve-completion`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).patch(`/api/v1/contracts/${contract._id}/approve-completion`);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('PATCH /api/v1/contracts/:id/request-revision', () => {
    it('should request revision successfully', async () => {
      // Set contract status to submitted for revision
      contract.status = 'submitted';
      await contract.save();
      const revisionData = {
        reason: 'Work needs improvement'
      };
      const res = await request(app)
        .patch(`/api/v1/contracts/${contract._id}/request-revision`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send(revisionData);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should return 400 for missing reason', async () => {
      // Set contract status to submitted for revision
      contract.status = 'submitted';
      await contract.save();
      const res = await request(app)
        .patch(`/api/v1/contracts/${contract._id}/request-revision`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 403 for non-provider users', async () => {
      const res = await request(app)
        .patch(`/api/v1/contracts/${contract._id}/request-revision`)
        .set('Authorization', `Bearer ${taskerToken}`)
        .send({ reason: 'Test reason' });

      expect(res.statusCode).toBe(403);
    });

    it('should return 404 for non-existent contract', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .patch(`/api/v1/contracts/${fakeId}/request-revision`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send({ reason: 'Test reason' });

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .patch(`/api/v1/contracts/${contract._id}/request-revision`)
        .send({ reason: 'Test reason' });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('PATCH /api/v1/contracts/:id/cancel', () => {
    it('should cancel contract successfully', async () => {
      const cancelData = {
        reason: 'Change of plans'
      };

      const res = await request(app)
        .patch(`/api/v1/contracts/${contract._id}/cancel`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send(cancelData);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should cancel contract without reason', async () => {
      const res = await request(app)
        .patch(`/api/v1/contracts/${contract._id}/cancel`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should return 404 for non-existent contract', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .patch(`/api/v1/contracts/${fakeId}/cancel`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send({ reason: 'Test reason' });

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .patch(`/api/v1/contracts/${contract._id}/cancel`)
        .send({ reason: 'Test reason' });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('DELETE /api/v1/contracts/:id', () => {
    it('should not allow provider to delete contract with assigned tasker', async () => {
      const res = await request(app)
        .delete(`/api/v1/contracts/${contract._id}`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.status).toBe('fail');
      expect(res.body.message).toContain('Cannot delete contract once a tasker has been assigned. Only administrators can delete assigned contracts.');
    });

    it('should not allow tasker to delete contract with assigned tasker', async () => {
      const res = await request(app)
        .delete(`/api/v1/contracts/${contract._id}`)
        .set('Authorization', `Bearer ${taskerToken}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.status).toBe('fail');
      expect(res.body.message).toContain('Cannot delete contract once a tasker has been assigned. Only administrators can delete assigned contracts.');
    });

    it('should allow admin to delete contract with assigned tasker', async () => {
      // Create an admin user and token
      const admin = await User.create({
        ...testUsers.provider,
        email: 'admin@test.com',
        phoneNo: '+1234567899', // Use unique phone number
        role: ['admin']
      });
      const adminToken = createToken(admin._id);

      const res = await request(app)
        .delete(`/api/v1/contracts/${contract._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(204);
    });

    it('should return 404 for non-existent contract', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .delete(`/api/v1/contracts/${fakeId}`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).delete(`/api/v1/contracts/${contract._id}`);
      expect(res.statusCode).toBe(401);
    });
  });
}); 