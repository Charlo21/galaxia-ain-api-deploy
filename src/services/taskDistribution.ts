import { pool } from '../config/database';
import { getActiveNodes } from './nodeRegistry';
import { Node } from '../types/node';
import { v4 as uuidv4 } from 'uuid';

export interface TaskRequirements {
  model_id: string;
  min_ram_gb?: number;
  requires_gpu?: boolean;
  region?: string;
  priority?: 'standard' | 'fast';
}

export interface Task {
  id: string;
  model_id: string;
  input_data: string;
  input_type: 'text' | 'image' | 'audio';
  priority: 'standard' | 'fast';
  region: string;
  assigned_nodes: string[];
  status: 'queued' | 'assigned' | 'processing' | 'completed' | 'failed';
  api_key_id?: string;
  cost_tokens: number;
  latency_ms?: number;
  created_at: Date;
  assigned_at?: Date;
  completed_at?: Date;
}

/**
 * Smart task distribution algorithm
 * Selects 2-3 nodes based on: reputation (40%) + geographic proximity (30%) + current load (30%)
 */
export async function assignTask(
  taskId: string,
  requirements: TaskRequirements
): Promise<string[]> {
  const client = await pool.connect();
  
  try {
    // Get all active nodes that can handle this task
    const allNodes = await getActiveNodes({
      model: requirements.model_id,
      region: requirements.region,
      minReputation: 30, // Minimum reputation threshold
    });
    
    // Filter nodes by capabilities
    const eligibleNodes = allNodes.filter(node => {
      const caps = node.capabilities;
      
      // Check RAM requirement
      if (requirements.min_ram_gb && caps.ram_gb < requirements.min_ram_gb) {
        return false;
      }
      
      // Check GPU requirement
      if (requirements.requires_gpu && !caps.gpu) {
        return false;
      }
      
      // Check if node supports the model
      if (!caps.models.includes(requirements.model_id)) {
        return false;
      }
      
      // Check if node has capacity
      if (node.current_load >= node.max_concurrent_tasks) {
        return false;
      }
      
      return true;
    });
    
    if (eligibleNodes.length === 0) {
      throw new Error('No eligible nodes available for task');
    }
    
    // Score and rank nodes
    const scoredNodes = eligibleNodes.map(node => {
      // Reputation score (0-40 points)
      const reputationScore = node.reputation * 0.4;
      
      // Geographic proximity score (0-30 points)
      // For now, prioritize nodes in same region (simplified)
      const geoScore = requirements.region && 
        node.location.region.toLowerCase().includes(requirements.region.toLowerCase())
        ? 30 : 15;
      
      // Load score (0-30 points) - less load = higher score
      const loadRatio = node.current_load / node.max_concurrent_tasks;
      const loadScore = (1 - loadRatio) * 30;
      
      const totalScore = reputationScore + geoScore + loadScore;
      
      return {
        node,
        score: totalScore,
      };
    });
    
    // Sort by score descending
    scoredNodes.sort((a, b) => b.score - a.score);
    
    // Select 2-3 nodes (prefer 3 for redundancy)
    const numNodes = Math.min(3, scoredNodes.length);
    const selectedNodes = scoredNodes.slice(0, numNodes).map(s => s.node);
    const selectedNodeIds = selectedNodes.map(n => n.id);
    
    // Update task with assigned nodes
    await client.query(
      `UPDATE tasks 
       SET assigned_nodes = $1, status = 'assigned', assigned_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [selectedNodeIds, taskId]
    );
    
    // Update node load
    for (const node of selectedNodes) {
      await client.query(
        'UPDATE nodes SET current_load = current_load + 1 WHERE id = $1',
        [node.id]
      );
    }
    
    return selectedNodeIds;
  } finally {
    client.release();
  }
}

/**
 * Create a new task
 */
export async function createTask(data: {
  model_id: string;
  input_data: string;
  input_type: 'text' | 'image' | 'audio';
  priority?: 'standard' | 'fast';
  region?: string;
  api_key_id?: string;
}): Promise<Task> {
  const client = await pool.connect();
  
  try {
    const taskId = uuidv4();
    
    // Calculate cost based on model
    const modelResult = await client.query(
      'SELECT * FROM models WHERE id = $1',
      [data.model_id]
    );
    
    if (modelResult.rows.length === 0) {
      throw new Error(`Model ${data.model_id} not found`);
    }
    
    const model = modelResult.rows[0];
    let cost = 0;
    
    if (data.input_type === 'text') {
      // Estimate tokens (rough: 1 token ≈ 4 characters)
      const estimatedTokens = data.input_data.length / 4;
      cost = (estimatedTokens / 1000) * parseFloat(model.cost_per_1k_tokens);
    } else if (data.input_type === 'image') {
      cost = parseFloat(model.cost_per_image);
    } else if (data.input_type === 'audio') {
      // Estimate duration (rough: 1 minute per 1MB)
      const estimatedMinutes = data.input_data.length / (1024 * 1024);
      cost = estimatedMinutes * parseFloat(model.cost_per_minute);
    }
    
    // Apply priority multiplier
    if (data.priority === 'fast') {
      cost *= 2;
    }
    
    const result = await client.query(
      `INSERT INTO tasks 
       (id, model_id, input_data, input_type, priority, region, api_key_id, cost_tokens, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued')
       RETURNING *`,
      [
        taskId,
        data.model_id,
        data.input_data,
        data.input_type,
        data.priority || 'standard',
        data.region || 'auto',
        data.api_key_id,
        cost,
      ]
    );
    
    return mapRowToTask(result.rows[0]);
  } finally {
    client.release();
  }
}

/**
 * Handle task failure and reassign
 */
export async function handleTaskFailure(
  taskId: string,
  failedNodeId: string
): Promise<string[]> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get task details
    const taskResult = await client.query(
      'SELECT * FROM tasks WHERE id = $1',
      [taskId]
    );
    
    if (taskResult.rows.length === 0) {
      throw new Error('Task not found');
    }
    
    const task = taskResult.rows[0];
    
    // Remove failed node from assigned nodes
    const assignedNodes = task.assigned_nodes || [];
    const remainingNodes = assignedNodes.filter((id: string) => id !== failedNodeId);
    
    // Decrease load on failed node
    await client.query(
      'UPDATE nodes SET current_load = GREATEST(0, current_load - 1), tasks_failed = tasks_failed + 1 WHERE id = $1',
      [failedNodeId]
    );
    
    // Update reputation
    await client.query(
      'UPDATE nodes SET reputation = GREATEST(0, reputation - 2) WHERE id = $1',
      [failedNodeId]
    );
    
    // If we still have nodes working, don't reassign yet
    if (remainingNodes.length > 0) {
      await client.query(
        'UPDATE tasks SET assigned_nodes = $1 WHERE id = $2',
        [remainingNodes, taskId]
      );
      await client.query('COMMIT');
      return remainingNodes;
    }
    
    // Reassign to new nodes
    const requirements: TaskRequirements = {
      model_id: task.model_id,
      region: task.region,
      priority: task.priority,
    };
    
    const newNodes = await assignTask(taskId, requirements);
    await client.query('COMMIT');
    return newNodes;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Complete a task
 */
export async function completeTask(
  taskId: string,
  nodeId: string,
  output: string,
  processingTimeMs: number
): Promise<void> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Record result
    await client.query(
      `INSERT INTO task_results (task_id, node_id, output_data, processing_time_ms)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (task_id, node_id) DO UPDATE
       SET output_data = $3, processing_time_ms = $4`,
      [taskId, nodeId, output, processingTimeMs]
    );
    
    // Decrease node load
    await client.query(
      'UPDATE nodes SET current_load = GREATEST(0, current_load - 1) WHERE id = $1',
      [nodeId]
    );
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get task by ID
 */
export async function getTask(taskId: string): Promise<Task | null> {
  const client = await pool.connect();
  
  try {
    const result = await client.query(
      'SELECT * FROM tasks WHERE id = $1',
      [taskId]
    );
    
    if (result.rows.length === 0) return null;
    return mapRowToTask(result.rows[0]);
  } finally {
    client.release();
  }
}

function mapRowToTask(row: any): Task {
  return {
    id: row.id,
    model_id: row.model_id,
    input_data: row.input_data,
    input_type: row.input_type,
    priority: row.priority,
    region: row.region,
    assigned_nodes: row.assigned_nodes || [],
    status: row.status,
    api_key_id: row.api_key_id,
    cost_tokens: parseFloat(row.cost_tokens) || 0,
    latency_ms: row.latency_ms,
    created_at: row.created_at,
    assigned_at: row.assigned_at,
    completed_at: row.completed_at,
  };
}

