/**
 * Load testing script for Galaxia API
 * Tests with 100+ concurrent requests
 * 
 * Usage: node tests/load-test.js
 */

const axios = require('axios');
const { performance } = require('perf_hooks');

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const CONCURRENT_REQUESTS = parseInt(process.env.CONCURRENT || '100');
const TOTAL_REQUESTS = parseInt(process.env.TOTAL || '1000');
const API_KEY = process.env.API_KEY || 'test-api-key';

let apiKey = null;
let userId = null;

async function generateApiKey() {
  try {
    userId = 'load-test-' + Date.now();
    const response = await axios.post(`${API_BASE_URL}/v1/api-keys`, {
      user_id: userId,
      name: 'Load Test Key'
    });
    return response.data.api_key;
  } catch (error) {
    console.error('Failed to generate API key:', error.message);
    return API_KEY;
  }
}

async function makeRequest(requestNum) {
  const startTime = performance.now();
  
  try {
    const response = await axios.post(
      `${API_BASE_URL}/v1/inference`,
      {
        model: 'llama-3-8b',
        input: `Load test request ${requestNum}: What is artificial intelligence?`,
        priority: 'standard'
      },
      {
        headers: {
          'X-API-Key': apiKey
        },
        timeout: 30000
      }
    );
    
    const latency = performance.now() - startTime;
    return {
      success: true,
      latency,
      status: response.status,
      taskId: response.data.task_id
    };
  } catch (error) {
    const latency = performance.now() - startTime;
    return {
      success: false,
      latency,
      status: error.response?.status || 0,
      error: error.message
    };
  }
}

async function runLoadTest() {
  console.log('🚀 Starting Load Test');
  console.log(`   API: ${API_BASE_URL}`);
  console.log(`   Concurrent: ${CONCURRENT_REQUESTS}`);
  console.log(`   Total Requests: ${TOTAL_REQUESTS}`);
  console.log('');

  // Generate API key
  console.log('Generating API key...');
  apiKey = await generateApiKey();
  console.log(`✅ API Key: ${apiKey.substring(0, 20)}...\n`);

  const results = {
    total: 0,
    successful: 0,
    failed: 0,
    latencies: [],
    errors: {}
  };

  const startTime = performance.now();
  let completed = 0;
  let currentBatch = 0;

  // Process in batches
  while (completed < TOTAL_REQUESTS) {
    const batchSize = Math.min(CONCURRENT_REQUESTS, TOTAL_REQUESTS - completed);
    const batch = [];

    for (let i = 0; i < batchSize; i++) {
      batch.push(makeRequest(completed + i + 1));
    }

    console.log(`Batch ${++currentBatch}: Sending ${batchSize} requests...`);
    const batchStart = performance.now();

    const batchResults = await Promise.all(batch);
    
    const batchTime = performance.now() - batchStart;

    // Process results
    for (const result of batchResults) {
      results.total++;
      if (result.success) {
        results.successful++;
        results.latencies.push(result.latency);
      } else {
        results.failed++;
        const errorKey = result.status || 'unknown';
        results.errors[errorKey] = (results.errors[errorKey] || 0) + 1;
      }
    }

    completed += batchSize;
    console.log(`   Completed: ${completed}/${TOTAL_REQUESTS} | Batch time: ${batchTime.toFixed(0)}ms | Success: ${results.successful} | Failed: ${results.failed}`);
  }

  const totalTime = performance.now() - startTime;

  // Calculate statistics
  const sortedLatencies = results.latencies.sort((a, b) => a - b);
  const p50 = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)];
  const p95 = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)];
  const p99 = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)];

  const avgLatency = results.latencies.reduce((a, b) => a + b, 0) / results.latencies.length;
  const minLatency = Math.min(...results.latencies);
  const maxLatency = Math.max(...results.latencies);

  const requestsPerSecond = (results.total / totalTime) * 1000;
  const successRate = (results.successful / results.total) * 100;

  // Print results
  console.log('\n' + '='.repeat(60));
  console.log('📊 Load Test Results');
  console.log('='.repeat(60));
  console.log(`Total Requests: ${results.total}`);
  console.log(`Successful: ${results.successful} (${successRate.toFixed(2)}%)`);
  console.log(`Failed: ${results.failed} (${(100 - successRate).toFixed(2)}%)`);
  console.log(`Total Time: ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`Requests/Second: ${requestsPerSecond.toFixed(2)}`);
  console.log('');
  console.log('Latency Statistics:');
  console.log(`  Average: ${avgLatency.toFixed(2)}ms`);
  console.log(`  Min: ${minLatency.toFixed(2)}ms`);
  console.log(`  Max: ${maxLatency.toFixed(2)}ms`);
  console.log(`  P50: ${p50.toFixed(2)}ms`);
  console.log(`  P95: ${p95.toFixed(2)}ms`);
  console.log(`  P99: ${p99.toFixed(2)}ms`);
  console.log('');

  if (results.failed > 0) {
    console.log('Errors:');
    for (const [status, count] of Object.entries(results.errors)) {
      console.log(`  ${status}: ${count}`);
    }
  }

  console.log('='.repeat(60));

  // Check if test passed
  if (successRate >= 95) {
    console.log('✅ Load test PASSED (success rate >= 95%)');
    process.exit(0);
  } else {
    console.log('❌ Load test FAILED (success rate < 95%)');
    process.exit(1);
  }
}

// Run test
runLoadTest().catch(error => {
  console.error('Load test failed:', error);
  process.exit(1);
});

