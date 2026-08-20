/**
 * Integration tests for Galaxia API Server
 */

import request from 'supertest';
import { app } from '../src/index';
import { pool } from '../src/config/database';

describe('API Integration Tests', () => {
  let apiKey: string;
  let userId: string;
  let nodeDeviceId: string;

  beforeAll(async () => {
    // Setup test data
    userId = 'test-user-' + Date.now();
    
    // Generate API key
    const keyRes = await request(app)
      .post('/v1/api-keys')
      .send({ user_id: userId, name: 'Test Key' });
    apiKey = keyRes.body.api_key;
    
    // Register test node
    nodeDeviceId = 'test-node-' + Date.now();
    await request(app)
      .post('/v1/nodes/register')
      .send({
        device_id: nodeDeviceId,
        wallet_address: '0x1234567890abcdef',
        capabilities: {
          cpu_cores: 4,
          gpu: false,
          ram_gb: 8,
          models: ['llama-3-8b', 'whisper']
        }
      });
  });

  afterAll(async () => {
    // Cleanup test data
    await pool.query('DELETE FROM api_keys WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM nodes WHERE device_id = $1', [nodeDeviceId]);
    await pool.end();
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBeDefined();
    });
  });

  describe('Node Registration', () => {
    it('should register a new node', async () => {
      const deviceId = 'test-node-' + Date.now();
      const res = await request(app)
        .post('/v1/nodes/register')
        .send({
          device_id: deviceId,
          wallet_address: '0xabcdef1234567890',
          capabilities: {
            cpu_cores: 8,
            gpu: true,
            ram_gb: 16,
            models: ['llama-3-8b', 'stable-diffusion']
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.node.device_id).toBe(deviceId);
    });

    it('should reject registration without required fields', async () => {
      const res = await request(app)
        .post('/v1/nodes/register')
        .send({
          device_id: 'test-node'
          // Missing wallet_address and capabilities
        });

      expect(res.status).toBe(400);
    });
  });

  describe('Inference API', () => {
    it('should create inference task', async () => {
      const res = await request(app)
        .post('/v1/inference')
        .set('X-API-Key', apiKey)
        .send({
          model: 'llama-3-8b',
          input: 'What is AI?',
          priority: 'standard'
        });

      expect(res.status).toBe(200);
      expect(res.body.task_id).toBeDefined();
      expect(res.body.status).toBe('queued');
    });

    it('should reject request without API key', async () => {
      const res = await request(app)
        .post('/v1/inference')
        .send({
          model: 'llama-3-8b',
          input: 'Test'
        });

      expect(res.status).toBe(401);
    });

    it('should reject invalid model', async () => {
      const res = await request(app)
        .post('/v1/inference')
        .set('X-API-Key', apiKey)
        .send({
          model: 'invalid-model',
          input: 'Test'
        });

      expect(res.status).toBe(400);
    });
  });

  describe('Task Status', () => {
    it('should get task status', async () => {
      // Create a task first
      const createRes = await request(app)
        .post('/v1/inference')
        .set('X-API-Key', apiKey)
        .send({
          model: 'llama-3-8b',
          input: 'Test query',
          priority: 'standard'
        });

      const taskId = createRes.body.task_id;

      // Get task status
      const res = await request(app)
        .get(`/v1/tasks/${taskId}`)
        .set('X-API-Key', apiKey);

      expect(res.status).toBe(200);
      expect(res.body.task_id).toBe(taskId);
      expect(res.body.status).toBeDefined();
    });
  });

  describe('Models List', () => {
    it('should return available models', async () => {
      const res = await request(app).get('/v1/models');

      expect(res.status).toBe(200);
      expect(res.body.models).toBeInstanceOf(Array);
      expect(res.body.models.length).toBeGreaterThan(0);
    });
  });

  describe('Admin Endpoints', () => {
    it('should return network stats', async () => {
      const res = await request(app).get('/v1/admin/stats');

      expect(res.status).toBe(200);
      expect(res.body.nodes).toBeDefined();
      expect(res.body.tasks).toBeDefined();
      expect(res.body.earnings).toBeDefined();
    });

    it('should return nodes list', async () => {
      const res = await request(app).get('/v1/admin/nodes');

      expect(res.status).toBe(200);
      expect(res.body.nodes).toBeInstanceOf(Array);
    });
  });
});

