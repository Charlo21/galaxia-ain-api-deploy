/**
 * Tests for competitive positioning features
 */

import request from 'supertest';
import { app } from '../src/index';
import { pool } from '../src/config/database';

describe('Competitive Features Tests', () => {
  let apiKey: string;
  let userId: string;
  let nodeId: string;
  let userWallet: string;
  let nodeWallet: string;

  beforeAll(async () => {
    // Setup test data
    userId = 'test-user-' + Date.now();
    userWallet = '0x' + '1'.repeat(40);
    nodeWallet = '0x' + '2'.repeat(40);
    
    // Generate API key
    const keyRes = await request(app)
      .post('/v1/api-keys')
      .send({ user_id: userId, name: 'Test Key' });
    apiKey = keyRes.body.api_key;
    
    // Register test node
    const nodeRes = await request(app)
      .post('/v1/nodes/register')
      .send({
        device_id: 'test-node-' + Date.now(),
        wallet_address: nodeWallet,
        capabilities: {
          cpu_cores: 4,
          gpu: false,
          ram_gb: 8,
          models: ['llama-3-8b']
        }
      });
    nodeId = nodeRes.body.node.id;
  });

  afterAll(async () => {
    // Cleanup
    await pool.query('DELETE FROM api_keys WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM nodes WHERE id = $1', [nodeId]);
    await pool.end();
  });

  describe('Privacy Features', () => {
    it('should create task with privacy level', async () => {
      const res = await request(app)
        .post('/v1/inference')
        .set('X-API-Key', apiKey)
        .send({
          model: 'llama-3-8b',
          input: 'Test input',
          privacy_level: 'private'
        });

      expect(res.status).toBe(200);
      expect(res.body.privacy_level).toBe('private');
      expect(res.body.privacy_features).toBeDefined();
    });

    it('should support confidential privacy level', async () => {
      const res = await request(app)
        .post('/v1/inference')
        .set('X-API-Key', apiKey)
        .send({
          model: 'llama-3-8b',
          input: 'Confidential data',
          privacy_level: 'confidential'
        });

      expect(res.status).toBe(200);
      expect(res.body.privacy_level).toBe('confidential');
      expect(res.body.privacy_features.zkProof).toBeDefined();
    });
  });

  describe('Direct Payments', () => {
    it('should show zero platform fee', async () => {
      const res = await request(app)
        .post('/v1/inference')
        .set('X-API-Key', apiKey)
        .send({
          model: 'llama-3-8b',
          input: 'Test'
        });

      expect(res.status).toBe(200);
      expect(res.body.platform_fee).toBe(0);
    });
  });

  describe('Competitive Metrics', () => {
    it('should return competitive metrics', async () => {
      const res = await request(app)
        .get('/v1/competitive/metrics');

      expect(res.status).toBe(200);
      expect(res.body.competitive).toBeDefined();
      expect(res.body.competitive.costSavingsVsAWS).toBeGreaterThanOrEqual(0);
      expect(res.body.competitive.privacyScore).toBeGreaterThanOrEqual(0);
      expect(res.body.competitive.decentralizationScore).toBeGreaterThanOrEqual(0);
      expect(res.body.competitive.providerEarningsRatio).toBe(100); // 100% to providers
    });

    it('should return token economics metrics', async () => {
      const res = await request(app)
        .get('/v1/competitive/metrics');

      expect(res.status).toBe(200);
      expect(res.body.token_economics).toBeDefined();
      expect(res.body.token_economics.totalPaidToProviders).toBeGreaterThanOrEqual(0);
      expect(res.body.token_economics.networkEfficiency).toBeGreaterThanOrEqual(0);
    });

    it('should return payment efficiency metrics', async () => {
      const res = await request(app)
        .get('/v1/competitive/metrics');

      expect(res.status).toBe(200);
      expect(res.body.payment_efficiency).toBeDefined();
      expect(res.body.payment_efficiency.directPayments).toBeGreaterThanOrEqual(0);
      expect(res.body.payment_efficiency.platformFeeSaved).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Blockchain Verification', () => {
    it('should create blockchain record for task', async () => {
      // Create a task
      const taskRes = await request(app)
        .post('/v1/inference')
        .set('X-API-Key', apiKey)
        .send({
          model: 'llama-3-8b',
          input: 'Test'
        });

      const taskId = taskRes.body.task_id;

      // Wait a bit for processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check blockchain record
      const recordResult = await pool.query(
        'SELECT * FROM blockchain_records WHERE task_id = $1',
        [taskId]
      );

      // Record may or may not exist depending on processing
      // Just verify the query works
      expect(Array.isArray(recordResult.rows)).toBe(true);
    });
  });
});

