import { pool } from '../config/database';
import { Node, NodeCapabilities, NodeLocation } from '../types/node';
import axios from 'axios';

export interface NodeRegistrationData {
  device_id: string;
  wallet_address: string;
  capabilities: NodeCapabilities;
  location?: Partial<NodeLocation>;
}

/**
 * Auto-detect node capabilities (CPU, GPU, RAM)
 */
export async function detectNodeCapabilities(): Promise<NodeCapabilities> {
  // In production, this would run on the node client
  // For now, return a placeholder structure
  return {
    cpu_cores: 4,
    gpu: false,
    ram_gb: 8,
    models: [],
  };
}

/**
 * Get location from IP address
 */
export async function getLocationFromIP(ip: string): Promise<NodeLocation> {
  try {
    const response = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city,lat,lon`);
    if (response.data.status === 'success') {
      return {
        country: response.data.country,
        region: response.data.regionName,
        city: response.data.city,
        lat: response.data.lat,
        lon: response.data.lon,
        ip: ip,
      };
    }
  } catch (error) {
    console.error('Failed to get location from IP:', error);
  }
  
  // Fallback
  return {
    country: 'Unknown',
    region: 'Unknown',
    city: 'Unknown',
    lat: 0,
    lon: 0,
    ip: ip,
  };
}

/**
 * Register a new node
 */
export async function registerNode(data: NodeRegistrationData, clientIP: string): Promise<Node> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get or create location
    let location: NodeLocation;
    if (data.location) {
      location = data.location as NodeLocation;
    } else {
      location = await getLocationFromIP(clientIP);
    }
    
    // Check if node already exists
    const existingNode = await client.query(
      'SELECT * FROM nodes WHERE device_id = $1',
      [data.device_id]
    );
    
    if (existingNode.rows.length > 0) {
      // Update existing node
      const result = await client.query(
        `UPDATE nodes 
         SET capabilities = $1, location = $2, status = 'online', last_seen = CURRENT_TIMESTAMP
         WHERE device_id = $3
         RETURNING *`,
        [JSON.stringify(data.capabilities), JSON.stringify(location), data.device_id]
      );
      await client.query('COMMIT');
      return mapRowToNode(result.rows[0]);
    }
    
    // Insert new node
    const result = await client.query(
      `INSERT INTO nodes (device_id, wallet_address, capabilities, location, status, last_seen)
       VALUES ($1, $2, $3, $4, 'online', CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        data.device_id,
        data.wallet_address,
        JSON.stringify(data.capabilities),
        JSON.stringify(location)
      ]
    );
    
    await client.query('COMMIT');
    return mapRowToNode(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Update node health/heartbeat
 */
export async function updateNodeHealth(
  deviceId: string,
  healthData: {
    cpu_usage?: number;
    memory_usage?: number;
    gpu_usage?: number;
    active_tasks?: number;
    response_time_ms?: number;
  }
): Promise<void> {
  const client = await pool.connect();
  
  try {
    // Update node last_seen and status
    await client.query(
      `UPDATE nodes 
       SET last_seen = CURRENT_TIMESTAMP, status = 'online'
       WHERE device_id = $1`,
      [deviceId]
    );
    
    // Log health data
    const nodeResult = await client.query(
      'SELECT id FROM nodes WHERE device_id = $1',
      [deviceId]
    );
    
    if (nodeResult.rows.length > 0) {
      const nodeId = nodeResult.rows[0].id;
      const isHealthy = 
        (healthData.cpu_usage || 0) < 90 &&
        (healthData.memory_usage || 0) < 90 &&
        (healthData.response_time_ms || 0) < 5000;
      
      await client.query(
        `INSERT INTO node_health_logs 
         (node_id, cpu_usage, memory_usage, gpu_usage, active_tasks, response_time_ms, is_healthy)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          nodeId,
          healthData.cpu_usage,
          healthData.memory_usage,
          healthData.gpu_usage,
          healthData.active_tasks,
          healthData.response_time_ms,
          isHealthy
        ]
      );
    }
  } finally {
    client.release();
  }
}

/**
 * Calculate and update node reputation
 */
export async function updateNodeReputation(nodeId: string): Promise<void> {
  const client = await pool.connect();
  
  try {
    const nodeResult = await client.query(
      'SELECT tasks_completed, tasks_failed, uptime_score FROM nodes WHERE id = $1',
      [nodeId]
    );
    
    if (nodeResult.rows.length === 0) return;
    
    const node = nodeResult.rows[0];
    const totalTasks = node.tasks_completed + node.tasks_failed;
    
    if (totalTasks === 0) {
      // New node, start with neutral reputation
      await client.query(
        'UPDATE nodes SET reputation = 50.0 WHERE id = $1',
        [nodeId]
      );
      return;
    }
    
    // Calculate reputation: 40% success rate + 40% uptime + 20% consistency
    const successRate = (node.tasks_completed / totalTasks) * 100;
    const uptimeWeight = node.uptime_score || 0;
    const reputation = (successRate * 0.4) + (uptimeWeight * 0.4) + 20;
    
    // Clamp between 0 and 100
    const clampedReputation = Math.max(0, Math.min(100, reputation));
    
    await client.query(
      'UPDATE nodes SET reputation = $1 WHERE id = $2',
      [clampedReputation, nodeId]
    );
  } finally {
    client.release();
  }
}

/**
 * Get all active nodes
 */
export async function getActiveNodes(filters?: {
  model?: string;
  region?: string;
  minReputation?: number;
}): Promise<Node[]> {
  const client = await pool.connect();
  
  try {
    let query = `SELECT * FROM nodes WHERE status = 'online' AND last_seen > NOW() - INTERVAL '5 minutes'`;
    const params: any[] = [];
    let paramIndex = 1;
    
    if (filters?.minReputation) {
      query += ` AND reputation >= $${paramIndex}`;
      params.push(filters.minReputation);
      paramIndex++;
    }
    
    if (filters?.region) {
      query += ` AND location->>'region' = $${paramIndex}`;
      params.push(filters.region);
      paramIndex++;
    }
    
    query += ` ORDER BY reputation DESC, current_load ASC`;
    
    const result = await client.query(query, params);
    return result.rows.map(mapRowToNode);
  } finally {
    client.release();
  }
}

/**
 * Get node by device ID
 */
export async function getNodeByDeviceId(deviceId: string): Promise<Node | null> {
  const client = await pool.connect();
  
  try {
    const result = await client.query(
      'SELECT * FROM nodes WHERE device_id = $1',
      [deviceId]
    );
    
    if (result.rows.length === 0) return null;
    return mapRowToNode(result.rows[0]);
  } finally {
    client.release();
  }
}

/**
 * Update node status
 */
export async function updateNodeStatus(
  deviceId: string,
  status: 'online' | 'offline' | 'busy' | 'blocked'
): Promise<void> {
  const client = await pool.connect();
  
  try {
    await client.query(
      'UPDATE nodes SET status = $1, last_seen = CURRENT_TIMESTAMP WHERE device_id = $2',
      [status, deviceId]
    );
  } finally {
    client.release();
  }
}

/**
 * Map database row to Node object
 */
function mapRowToNode(row: any): Node {
  return {
    id: row.id,
    device_id: row.device_id,
    wallet_address: row.wallet_address,
    capabilities: row.capabilities,
    location: row.location,
    uptime_score: parseFloat(row.uptime_score) || 0,
    reputation: parseFloat(row.reputation) || 50,
    tasks_completed: row.tasks_completed || 0,
    tasks_failed: row.tasks_failed || 0,
    total_earnings: parseFloat(row.total_earnings) || 0,
    status: row.status,
    last_seen: row.last_seen,
    registered_at: row.registered_at,
    current_load: row.current_load || 0,
    max_concurrent_tasks: row.max_concurrent_tasks || 3,
  };
}

