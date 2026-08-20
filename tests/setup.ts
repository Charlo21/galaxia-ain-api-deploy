/**
 * Test setup file
 */

// Set test environment
process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'galaxia_test';
process.env.LOG_LEVEL = 'error'; // Reduce log noise in tests

// Increase timeout for integration tests
jest.setTimeout(30000);

