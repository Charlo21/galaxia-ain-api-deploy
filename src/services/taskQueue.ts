import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/database';
import { verifyTaskResults } from './resultVerification';
import { distributeNodePayments } from './payment';
import { runInference, InferenceRequest } from './aiInference';
import { logger } from '../index';

interface QueuedTask {
  taskId: string;
  model: string;
  input: string;
  inputType: 'text' | 'image' | 'audio';
  nodeIds: string[];
  retries: number;
  maxRetries: number;
  privacyLevel?: 'public' | 'private' | 'confidential';
}

class TaskQueue {
  private queue: QueuedTask[] = [];
  private processing: Set<string> = new Set();
  private maxConcurrent: number = 10;

  /**
   * Add task to queue for async processing
   */
  async enqueue(
    taskId: string,
    model: string,
    input: string,
    inputType: 'text' | 'image' | 'audio',
    privacyLevel?: 'public' | 'private' | 'confidential'
  ): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Assign to nodes
    const { assignTask } = await import('./taskDistribution');
    const nodeIds = await assignTask(taskId, {
      model_id: model,
      priority: task.priority,
      region: task.region,
    });

    const queuedTask: QueuedTask = {
      taskId,
      model,
      input,
      inputType,
      nodeIds,
      retries: 0,
      maxRetries: 3,
      privacyLevel,
    };

    this.queue.push(queuedTask);
    this.processQueue();
  }

  /**
   * Process queue with concurrency limit
   */
  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.processing.size < this.maxConcurrent) {
      const task = this.queue.shift();
      if (!task) break;

      if (this.processing.has(task.taskId)) continue;

      this.processing.add(task.taskId);
      this.processTask(task).catch(err => {
        logger.error(`Task ${task.taskId} processing error:`, err);
        this.processing.delete(task.taskId);
        
        // Retry if not exceeded max retries
        if (task.retries < task.maxRetries) {
          task.retries++;
          this.queue.push(task);
        } else {
          // Mark task as failed
          this.markTaskFailed(task.taskId, err.message);
        }
      });
    }
  }

  /**
   * Process individual task
   */
  private async processTask(task: QueuedTask): Promise<void> {
    logger.info(`Processing task ${task.taskId} on ${task.nodeIds.length} nodes`);

    try {
      // Handle privacy-preserving computation
      let processedInput = task.input;
      if (task.privacyLevel && task.privacyLevel !== 'public') {
        try {
          const { processPrivateTask } = await import('./privacy/zkProofs');
          const privacyResult = await processPrivateTask(task.taskId, task.input, task.privacyLevel);
          if (privacyResult.encryptedInput) {
            processedInput = privacyResult.encryptedInput;
          }
        } catch (error: any) {
          logger.warn('Privacy processing failed, using standard input', { error: error.message });
        }
      }

      // Run inference
      const inferenceRequest: InferenceRequest = {
        model: task.model as any,
        input: processedInput,
        input_type: task.inputType,
      };

      const result = await runInference(inferenceRequest);

      // Simulate all nodes completing with same result
      const client = await pool.connect();
      try {
        for (const nodeId of task.nodeIds) {
          await client.query(
            `INSERT INTO task_results (task_id, node_id, output_data, processing_time_ms, verification_status)
             VALUES ($1, $2, $3, $4, 'pending')
             ON CONFLICT (task_id, node_id) DO UPDATE
             SET output_data = $3, processing_time_ms = $4`,
            [task.taskId, nodeId, result.output, result.processing_time_ms]
          );
        }
      } finally {
        client.release();
      }

      // Verify results
      const verification = await verifyTaskResults(task.taskId);
      
      if (verification.consensus) {
        // Get task and user info for direct payment
        const client = await pool.connect();
        try {
          const taskResult = await client.query(
            'SELECT user_id, privacy_level FROM tasks WHERE id = $1',
            [task.taskId]
          );
          
          const taskData = taskResult.rows[0];
          const userId = taskData?.user_id;
          
          // Get user wallet if available
          let userWallet: string | undefined;
          if (userId) {
            const userResult = await client.query(
              'SELECT wallet_address FROM users WHERE id = $1',
              [userId]
            );
            userWallet = userResult.rows[0]?.wallet_address;
          }
          
          // Distribute payments (with direct payment support)
          await distributeNodePayments(task.taskId, task.nodeIds, userId, userWallet);
          
          // Record on blockchain for verifiable computation
          try {
            const { recordOnChain } = await import('./blockchain/verification');
            const crypto = require('crypto');
            const resultHash = crypto.createHash('sha256').update(result.output).digest('hex');
            await recordOnChain(task.taskId, task.nodeIds, resultHash);
          } catch (error: any) {
            logger.warn('Blockchain recording failed', { error: error.message });
          }
        } finally {
          client.release();
        }
        
        logger.info(`Task ${task.taskId} completed successfully`);
      } else {
        logger.warn(`Task ${task.taskId} consensus failed`);
      }

      this.processing.delete(task.taskId);
      this.processQueue(); // Process next task
    } catch (error: any) {
      this.processing.delete(task.taskId);
      throw error;
    }
  }

  /**
   * Get task from database
   */
  private async getTask(taskId: string): Promise<any> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM tasks WHERE id = $1',
        [taskId]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  /**
   * Mark task as failed
   */
  private async markTaskFailed(taskId: string, errorMessage: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE tasks SET status = 'failed', error_message = $1 WHERE id = $2`,
        [errorMessage, taskId]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Get queue status
   */
  getStatus(): { queued: number; processing: number } {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
    };
  }
}

export const taskQueue = new TaskQueue();
