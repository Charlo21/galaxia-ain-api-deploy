import { Pool } from 'pg';
import { config } from 'dotenv';
import { getPoolConfig } from './databaseConfig';

config();

export const pool = new Pool(getPoolConfig());

pool.on('connect', () => {
  if (process.env.LOG_LEVEL === 'debug') {
    console.log('Connected to PostgreSQL database');
  }
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  if (process.env.NODE_ENV === 'production') {
    process.exit(-1);
  }
});

export default pool;
