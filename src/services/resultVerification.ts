import { pool } from '../config/database';
import { updateNodeReputation } from './nodeRegistry';
import { assignTask, TaskRequirements } from './taskDistribution';

/**
 * Verify task results using consensus mechanism
 * Returns consensus result if 2/3 nodes agree, otherwise triggers tiebreaker
 */
export async function verifyTaskResults(taskId: string): Promise<{
  consensus: boolean;
  finalOutput?: string;
  confidence?: number;
  consensusType?: 'majority' | 'unanimous' | 'tiebreaker';
}> {
  const client = await pool.connect();
  
  try {
    // Get all results for this task
    const resultsResult = await client.query(
      'SELECT * FROM task_results WHERE task_id = $1 AND verification_status = $2',
      [taskId, 'pending']
    );
    
    if (resultsResult.rows.length === 0) {
      return { consensus: false };
    }
    
    const results = resultsResult.rows;
    
    // Get task details to determine if it's deterministic
    const taskResult = await client.query(
      'SELECT * FROM tasks WHERE id = $1',
      [taskId]
    );
    
    if (taskResult.rows.length === 0) {
      return { consensus: false };
    }
    
    const task = taskResult.rows[0];
    const isDeterministic = task.model_id === 'whisper'; // Audio transcription is deterministic
    
    if (isDeterministic) {
      return await verifyDeterministicResults(taskId, results);
    } else {
      return await verifyNonDeterministicResults(taskId, results);
    }
  } finally {
    client.release();
  }
}

/**
 * Verify deterministic results (exact match required)
 */
async function verifyDeterministicResults(
  taskId: string,
  results: any[]
): Promise<{
  consensus: boolean;
  finalOutput?: string;
  confidence?: number;
  consensusType?: 'majority' | 'unanimous' | 'tiebreaker';
}> {
  const client = await pool.connect();
  
  try {
    // Group results by exact output
    const outputGroups = new Map<string, string[]>();
    
    for (const result of results) {
      const output = result.output_data.trim();
      if (!outputGroups.has(output)) {
        outputGroups.set(output, []);
      }
      outputGroups.get(output)!.push(result.node_id);
    }
    
    // Find majority output
    let maxCount = 0;
    let majorityOutput = '';
    let majorityNodes: string[] = [];
    
    for (const [output, nodeIds] of outputGroups.entries()) {
      if (nodeIds.length > maxCount) {
        maxCount = nodeIds.length;
        majorityOutput = output;
        majorityNodes = nodeIds;
      }
    }
    
    const totalNodes = results.length;
    const consensusThreshold = Math.ceil(totalNodes * 0.66); // 66% consensus
    
    if (maxCount >= consensusThreshold) {
      // Consensus reached
      const disagreeingNodes = results
        .filter(r => !majorityNodes.includes(r.node_id))
        .map(r => r.node_id);
      
      // Mark results
      await client.query(
        `UPDATE task_results 
         SET verification_status = CASE 
           WHEN node_id = ANY($1) THEN 'verified'
           ELSE 'rejected'
         END
         WHERE task_id = $2`,
        [majorityNodes, taskId]
      );
      
      // Update node reputations
      for (const nodeId of majorityNodes) {
        await client.query(
          'UPDATE nodes SET tasks_completed = tasks_completed + 1 WHERE id = $1',
          [nodeId]
        );
        await updateNodeReputation(nodeId);
      }
      
      // Penalize disagreeing nodes
      for (const nodeId of disagreeingNodes) {
        await client.query(
          'UPDATE nodes SET reputation = GREATEST(0, reputation - 5) WHERE id = $1',
          [nodeId]
        );
      }
      
      // Save consensus result
      await client.query(
        `INSERT INTO consensus_results 
         (task_id, final_output, consensus_type, agreeing_nodes, disagreeing_nodes, confidence_score)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          taskId,
          majorityOutput,
          maxCount === totalNodes ? 'unanimous' : 'majority',
          majorityNodes,
          disagreeingNodes,
          (maxCount / totalNodes) * 100
        ]
      );
      
      // Mark task as completed
      await client.query(
        `UPDATE tasks 
         SET status = 'completed', completed_at = CURRENT_TIMESTAMP, latency_ms = (
           SELECT AVG(processing_time_ms) FROM task_results WHERE task_id = $1
         )
         WHERE id = $1`,
        [taskId]
      );
      
      return {
        consensus: true,
        finalOutput: majorityOutput,
        confidence: (maxCount / totalNodes) * 100,
        consensusType: maxCount === totalNodes ? 'unanimous' : 'majority',
      };
    } else {
      // No consensus - trigger tiebreaker
      return await runTiebreaker(taskId, results);
    }
  } finally {
    client.release();
  }
}

/**
 * Verify non-deterministic results (similarity threshold)
 */
async function verifyNonDeterministicResults(
  taskId: string,
  results: any[]
): Promise<{
  consensus: boolean;
  finalOutput?: string;
  confidence?: number;
  consensusType?: 'majority' | 'unanimous' | 'tiebreaker';
}> {
  const client = await pool.connect();
  
  try {
    // Calculate similarity between all pairs
    const similarities: Array<{ node1: string; node2: string; similarity: number }> = [];
    
    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const similarity = calculateSimilarity(
          results[i].output_data,
          results[j].output_data
        );
        similarities.push({
          node1: results[i].node_id,
          node2: results[j].node_id,
          similarity,
        });
      }
    }
    
    // Find clusters of similar results (90%+ similarity)
    const clusters: string[][] = [];
    const processed = new Set<string>();
    
    for (const sim of similarities) {
      if (sim.similarity >= 90 && !processed.has(sim.node1) && !processed.has(sim.node2)) {
        // Find existing cluster or create new
        let cluster = clusters.find(c => c.includes(sim.node1) || c.includes(sim.node2));
        if (!cluster) {
          cluster = [];
          clusters.push(cluster);
        }
        if (!cluster.includes(sim.node1)) cluster.push(sim.node1);
        if (!cluster.includes(sim.node2)) cluster.push(sim.node2);
        processed.add(sim.node1);
        processed.add(sim.node2);
      }
    }
    
    // Find largest cluster
    if (clusters.length === 0) {
      return await runTiebreaker(taskId, results);
    }
    
    clusters.sort((a, b) => b.length - a.length);
    const majorityCluster = clusters[0];
    const totalNodes = results.length;
    const consensusThreshold = Math.ceil(totalNodes * 0.66);
    
    if (majorityCluster.length >= consensusThreshold) {
      // Consensus reached
      const majorityOutput = results.find(r => majorityCluster.includes(r.node_id))!.output_data;
      const disagreeingNodes = results
        .filter(r => !majorityCluster.includes(r.node_id))
        .map(r => r.node_id);
      
      // Update results
      await client.query(
        `UPDATE task_results 
         SET verification_status = CASE 
           WHEN node_id = ANY($1) THEN 'verified'
           ELSE 'rejected'
         END,
         similarity_score = CASE
           WHEN node_id = ANY($1) THEN 95.0
           ELSE 50.0
         END
         WHERE task_id = $2`,
        [majorityCluster, taskId]
      );
      
      // Update reputations
      for (const nodeId of majorityCluster) {
        await client.query(
          'UPDATE nodes SET tasks_completed = tasks_completed + 1 WHERE id = $1',
          [nodeId]
        );
        await updateNodeReputation(nodeId);
      }
      
      for (const nodeId of disagreeingNodes) {
        await client.query(
          'UPDATE nodes SET reputation = GREATEST(0, reputation - 3) WHERE id = $1',
          [nodeId]
        );
      }
      
      // Save consensus
      await client.query(
        `INSERT INTO consensus_results 
         (task_id, final_output, consensus_type, agreeing_nodes, disagreeing_nodes, confidence_score)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          taskId,
          majorityOutput,
          majorityCluster.length === totalNodes ? 'unanimous' : 'majority',
          majorityCluster,
          disagreeingNodes,
          (majorityCluster.length / totalNodes) * 100
        ]
      );
      
      // Mark task completed
      await client.query(
        `UPDATE tasks 
         SET status = 'completed', completed_at = CURRENT_TIMESTAMP, latency_ms = (
           SELECT AVG(processing_time_ms) FROM task_results WHERE task_id = $1
         )
         WHERE id = $1`,
        [taskId]
      );
      
      return {
        consensus: true,
        finalOutput: majorityOutput,
        confidence: (majorityCluster.length / totalNodes) * 100,
        consensusType: majorityCluster.length === totalNodes ? 'unanimous' : 'majority',
      };
    } else {
      // No consensus - tiebreaker
      return await runTiebreaker(taskId, results);
    }
  } finally {
    client.release();
  }
}

/**
 * Run tiebreaker with 2 additional high-reputation nodes
 */
async function runTiebreaker(
  taskId: string,
  existingResults: any[]
): Promise<{
  consensus: boolean;
  finalOutput?: string;
  confidence?: number;
  consensusType?: 'majority' | 'unanimous' | 'tiebreaker';
}> {
  const client = await pool.connect();
  
  try {
    // Get task details
    const taskResult = await client.query(
      'SELECT * FROM tasks WHERE id = $1',
      [taskId]
    );
    
    if (taskResult.rows.length === 0) {
      return { consensus: false };
    }
    
    const task = taskResult.rows[0];
    
    // Get 2 highest reputation nodes that haven't worked on this task
    const existingNodeIds = existingResults.map(r => r.node_id);
    const tiebreakerNodes = await client.query(
      `SELECT id FROM nodes 
       WHERE status = 'online' 
       AND id != ALL($1)
       AND reputation >= 70
       AND current_load < max_concurrent_tasks
       ORDER BY reputation DESC
       LIMIT 2`,
      [existingNodeIds]
    );
    
    if (tiebreakerNodes.rows.length < 2) {
      // Not enough high-reputation nodes available
      // Mark task as failed
      await client.query(
        `UPDATE tasks SET status = 'failed', error_message = 'Consensus failed: insufficient tiebreaker nodes' WHERE id = $1`,
        [taskId]
      );
      return { consensus: false };
    }
    
    // Assign to tiebreaker nodes (this would trigger actual inference in production)
    // For now, we'll mark that tiebreaker is needed
    // In production, this would queue new subtasks for these nodes
    
    // Find most common output from existing results
    const outputCounts = new Map<string, number>();
    for (const result of existingResults) {
      const output = result.output_data;
      outputCounts.set(output, (outputCounts.get(output) || 0) + 1);
    }
    
    let maxCount = 0;
    let finalOutput = '';
    for (const [output, count] of outputCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        finalOutput = output;
      }
    }
    
    // Use the most common output as final result (with lower confidence)
    await client.query(
      `INSERT INTO consensus_results 
       (task_id, final_output, consensus_type, agreeing_nodes, confidence_score)
       VALUES ($1, $2, 'tiebreaker', $3, $4)`,
      [
        taskId,
        finalOutput,
        existingResults.map(r => r.node_id),
        60.0 // Lower confidence for tiebreaker
      ]
    );
    
    await client.query(
      `UPDATE tasks 
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [taskId]
    );
    
    return {
      consensus: true,
      finalOutput,
      confidence: 60.0,
      consensusType: 'tiebreaker',
    };
  } finally {
    client.release();
  }
}

/**
 * Calculate similarity between two strings (simple Levenshtein-based)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 100;
  
  const distance = levenshteinDistance(str1, str2);
  const similarity = ((longer.length - distance) / longer.length) * 100;
  
  return Math.max(0, Math.min(100, similarity));
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

