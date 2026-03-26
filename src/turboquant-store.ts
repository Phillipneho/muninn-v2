/**
 * TurboQuant Store - Python Bridge
 * 
 * Uses the validated Python implementation for accurate compression.
 * TypeScript wrapper for integration with Muninn.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PYTHON_SCRIPT = `
import sys
import json
import torch

# Add turboquant_pkg to path
sys.path.insert(0, '/home/homelab/projects/turboquant_pkg')

from turboquant import TurboQuantProd

# Read input
data = json.load(sys.stdin)
action = data['action']

if action == 'compress':
    embedding = torch.tensor(data['embedding'])
    bits = data.get('bits', 3)
    seed = data.get('seed', 42)
    
    # Normalize
    embedding = embedding / torch.norm(embedding, dim=-1, keepdim=True)
    
    quantizer = TurboQuantProd(embedding.shape[-1], bits, seed=seed)
    compressed = quantizer.quantize(embedding)
    
    # Output as base64
    import base64
    result = {
        'mse_indices': base64.b64encode(compressed['mse_indices'].numpy().tobytes()).decode(),
        'qjl_signs': base64.b64encode(compressed['qjl_signs'].numpy().tobytes()).decode(),
        'residual_norm': float(compressed['residual_norm']),
        'bits': bits,
        'dimension': embedding.shape[-1],
    }
    print(json.dumps(result))

elif action == 'decompress':
    import base64
    import numpy as np
    
    mse_indices = np.frombuffer(base64.b64decode(data['mse_indices']), dtype=np.int64)
    qjl_signs = np.frombuffer(base64.b64decode(data['qjl_signs']), dtype=np.uint8)
    residual_norm = data['residual_norm']
    bits = data['bits']
    dimension = data['dimension']
    
    # Reconstruct (simplified - use quantizer)
    embedding = torch.randn(dimension)  # Placeholder
    quantizer = TurboQuantProd(dimension, bits, seed=data.get('seed', 42))
    
    # We need to implement proper decompression
    # For now, return the shape info
    result = {
        'dimension': dimension,
        'status': 'decompress requires implementation',
    }
    print(json.dumps(result))

elif action == 'inner_product':
    import base64
    import numpy as np
    
    query = torch.tensor(data['query'])
    mse_indices = np.frombuffer(base64.b64decode(data['mse_indices']), dtype=np.int64)
    qjl_signs = np.frombuffer(base64.b64decode(data['qjl_signs']), dtype=np.uint8)
    residual_norm = data['residual_norm']
    bits = data['bits']
    dimension = data['dimension']
    
    quantizer = TurboQuantProd(dimension, bits, seed=data.get('seed', 42))
    
    # Reconstruct compressed format
    compressed = {
        'mse_indices': torch.from_numpy(mse_indices),
        'qjl_signs': torch.from_numpy(qjl_signs),
        'residual_norm': residual_norm,
    }
    
    ip = quantizer.inner_product(query.unsqueeze(0), compressed)
    result = {'inner_product': float(ip[0])}
    print(json.dumps(result))
`;

export interface TurboQuantConfig {
  dimension?: number;
  bits?: number;
  seed?: number;
  pythonPath?: string;
}

export interface CompressedEmbedding {
  mse_indices: string;  // base64
  qjl_signs: string;    // base64
  residual_norm: number;
  bits: number;
  dimension: number;
}

/**
 * TurboQuant Store using Python implementation
 */
export class TurboQuantStore {
  private dimension: number;
  private bits: number;
  private seed: number;
  private pythonPath: string;
  
  constructor(config?: TurboQuantConfig) {
    this.dimension = config?.dimension ?? 768;
    this.bits = config?.bits ?? 3;
    this.seed = config?.seed ?? 42;
    this.pythonPath = config?.pythonPath ?? 'python3';
  }
  
  /**
   * Compress an embedding using Python TurboQuant
   */
  async compress(embedding: number[]): Promise<CompressedEmbedding> {
    const input = JSON.stringify({
      action: 'compress',
      embedding,
      bits: this.bits,
      seed: this.seed,
    });
    
    const { stdout } = await execAsync(
      `${this.pythonPath} -c '${PYTHON_SCRIPT.replace(/'/g, "'\"'\"'")}'`,
      {
        input,
        maxBuffer: 1024 * 1024 * 10,
      }
    );
    
    return JSON.parse(stdout);
  }
  
  /**
   * Compute inner product for similarity search
   */
  async innerProduct(
    query: number[],
    compressed: CompressedEmbedding
  ): Promise<number> {
    const input = JSON.stringify({
      action: 'inner_product',
      query,
      ...compressed,
      seed: this.seed,
    });
    
    const { stdout } = await execAsync(
      `${this.pythonPath} -c '${PYTHON_SCRIPT.replace(/'/g, "'\"'\"'")}'`,
      {
        input,
        maxBuffer: 1024 * 1024 * 10,
      }
    );
    
    const result = JSON.parse(stdout);
    return result.inner_product;
  }
  
  /**
   * Get compression ratio
   */
  getCompressionRatio(): number {
    const originalBits = this.dimension * 16; // FP16
    const compressedBits = this.dimension * this.bits + this.dimension + 16;
    return originalBits / compressedBits;
  }
  
  /**
   * Get compressed size in bytes
   */
  getCompressedSize(): number {
    const indicesBytes = Math.ceil(this.dimension * this.bits / 8);
    const signsBytes = Math.ceil(this.dimension / 8);
    const normsBytes = 8; // Float64 for residual_norm
    return indicesBytes + signsBytes + normsBytes;
  }
}

/**
 * Singleton instance
 */
let defaultInstance: TurboQuantStore | null = null;

export function getTurboQuantStore(config?: TurboQuantConfig): TurboQuantStore {
  if (!defaultInstance || config) {
    defaultInstance = new TurboQuantStore(config);
  }
  return defaultInstance;
}

/**
 * Convenience function to compress an embedding
 */
export async function compressEmbedding(
  embedding: number[],
  config?: TurboQuantConfig
): Promise<Buffer> {
  const store = getTurboQuantStore(config);
  const compressed = await store.compress(embedding);
  
  // Serialize to Buffer
  const mseIndicesBuffer = Buffer.from(compressed.mse_indices, 'base64');
  const qjlSignsBuffer = Buffer.from(compressed.qjl_signs, 'base64');
  
  const totalSize = 4 + 1 + 8 + 8 + mseIndicesBuffer.length + qjlSignsBuffer.length;
  const buffer = Buffer.alloc(totalSize);
  let offset = 0;
  
  buffer.writeUInt32LE(compressed.dimension, offset); offset += 4;
  buffer.writeUInt8(compressed.bits, offset); offset += 1;
  buffer.writeDoubleLE(compressed.residual_norm, offset); offset += 8;
  buffer.writeDoubleLE(1.0, offset); offset += 8; // original_norm (normalized = 1)
  mseIndicesBuffer.copy(buffer, offset); offset += mseIndicesBuffer.length;
  qjlSignsBuffer.copy(buffer, offset);
  
  return buffer;
}