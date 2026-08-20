import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface InferenceRequest {
  model: 'llama-3-8b' | 'stable-diffusion' | 'whisper';
  input: string; // Text, base64 image, or base64 audio
  input_type: 'text' | 'image' | 'audio';
}

export interface InferenceResult {
  output: string;
  processing_time_ms: number;
  tokens_used?: number;
}

/**
 * Run AI inference in Docker container (sandboxed)
 */
export async function runInference(request: InferenceRequest): Promise<InferenceResult> {
  const startTime = Date.now();
  const taskId = uuidv4();
  
  try {
    // Create temporary input file
    const tempDir = path.join(process.cwd(), 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    const inputFile = path.join(tempDir, `${taskId}_input`);
    const outputFile = path.join(tempDir, `${taskId}_output`);
    
    // Write input data
    if (request.input_type === 'text') {
      await fs.writeFile(inputFile, request.input, 'utf-8');
    } else {
      // Decode base64
      const buffer = Buffer.from(request.input, 'base64');
      await fs.writeFile(inputFile, buffer);
    }
    
    // Sanitize file paths to prevent command injection
    const sanitizedInputFile = path.resolve(tempDir, path.basename(inputFile));
    const sanitizedOutputFile = path.resolve(tempDir, path.basename(outputFile));
    
    // Verify paths are within temp directory
    if (!sanitizedInputFile.startsWith(path.resolve(tempDir)) ||
        !sanitizedOutputFile.startsWith(path.resolve(tempDir))) {
      throw new Error('Invalid file path detected');
    }
    
    // Run inference in Docker container
    const result = await runDockerInference({
      model: request.model,
      inputFile: sanitizedInputFile,
      outputFile: sanitizedOutputFile,
      taskId,
    });
    
    // Read output
    const output = await fs.readFile(outputFile, 'utf-8');
    
    // Cleanup
    await fs.unlink(inputFile).catch(() => {});
    await fs.unlink(outputFile).catch(() => {});
    
    const processingTime = Date.now() - startTime;
    
    return {
      output: output.trim(),
      processing_time_ms: processingTime,
      tokens_used: request.input_type === 'text' ? estimateTokens(request.input) : undefined,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Inference failed: ${message}`);
  }
}

/**
 * Run inference in Docker container with resource limits
 */
async function runDockerInference(options: {
  model: string;
  inputFile: string;
  outputFile: string;
  taskId: string;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    // Docker run command with resource limits
    const dockerArgs = [
      'run',
      '--rm',
      '--network', 'none', // No network access
      '--memory', '4g', // 4GB RAM limit
      '--cpus', '2', // 2 CPU cores
      '--timeout', '30', // 30 second timeout
      '-v', `${path.dirname(options.inputFile)}:/input:ro`,
      '-v', `${path.dirname(options.outputFile)}:/output:rw`,
      `galaxia-${options.model}:latest`,
      'python', '/app/infer.py',
      '--model', options.model,
      '--input', `/input/${path.basename(options.inputFile)}`,
      '--output', `/output/${path.basename(options.outputFile)}`,
    ];
    
    const dockerProcess = spawn('docker', dockerArgs, {
      stdio: 'pipe',
      timeout: 30000, // 30 second timeout
    });
    
    let stderr = '';
    
    dockerProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    dockerProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Docker process exited with code ${code}: ${stderr}`));
      }
    });
    
    dockerProcess.on('error', (error) => {
      reject(new Error(`Failed to start Docker: ${error.message}`));
    });
  });
}

/**
 * Estimate token count (rough: 1 token ≈ 4 characters)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Validate input for security
 */
export function validateInput(input: string, inputType: 'text' | 'image' | 'audio'): boolean {
  // Check for obvious malicious patterns
  const maliciousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /eval\(/i,
    /exec\(/i,
    /system\(/i,
  ];
  
  for (const pattern of maliciousPatterns) {
    if (pattern.test(input)) {
      return false;
    }
  }
  
  // Size limits
  if (inputType === 'text' && input.length > 100000) {
    return false; // 100KB text limit
  }
  
  if (inputType === 'image' && input.length > 10000000) {
    return false; // 10MB image limit
  }
  
  if (inputType === 'audio' && input.length > 50000000) {
    return false; // 50MB audio limit
  }
  
  return true;
}

