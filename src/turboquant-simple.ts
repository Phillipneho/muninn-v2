/**
 * TurboQuant for Muninn Cloud
 * 
 * Simple application-layer compression. No persistent server needed.
 * 
 * Usage:
 *   import { compress, similarity } from './turboquant-simple.js';
 *   
 *   // Compress before storing
 *   const compressed = await compress(embedding);
 *   
 *   // Search directly on compressed data
 *   const score = await similarity(query, compressed);
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Python script for compression (runs once, then cached)
const COMPRESS_SCRIPT = `
import sys, json, torch, base64, numpy as np
sys.path.insert(0, '/home/homelab/projects/turboquant_pkg')
from turboquant import TurboQuantProd

data = json.load(sys.stdin)
embedding = torch.tensor(data['e'])
embedding = embedding / torch.norm(embedding)
quantizer = TurboQuantProd(len(data['e']), data.get('b', 3), seed=42)
compressed = quantizer.quantize(embedding)

print(json.dumps({
  'i': base64.b64encode(compressed['mse_indices'].numpy().tobytes()).decode(),
  's': base64.b64encode(compressed['qjl_signs'].numpy().tobytes()).decode(),
  'r': float(compressed['residual_norm']),
  'd': len(data['e']),
  'b': data.get('b', 3),
}))
`;

const SIMILARITY_SCRIPT = `
import sys, json, torch, base64, numpy as np
sys.path.insert(0, '/home/homelab/projects/turboquant_pkg')
from turboquant import TurboQuantProd

data = json.load(sys.stdin)
query = torch.tensor(data['q'])
query = query / torch.norm(query)

compressed = {
  'mse_indices': torch.from_numpy(np.frombuffer(base64.b64decode(data['i']), dtype=np.int64)),
  'qjl_signs': torch.from_numpy(np.frombuffer(base64.b64decode(data['s']), dtype=np.uint8)),
  'residual_norm': data['r'],
}
quantizer = TurboQuantProd(data['d'], data.get('b', 3), seed=42)
ip = quantizer.inner_product(query.unsqueeze(0), compressed)
print(json.dumps({'s': float(ip[0])}))
`;

// Cache for compiled Python (speeds up subsequent calls)
let pythonReady = false;

/**
 * Compress an embedding (768-dim or 1536-dim)
 * Returns a Buffer ready for Supabase storage
 */
export async function compress(embedding: number[], bits: number = 3): Promise<Buffer> {
  const { stdout } = await execAsync(
    `python3 -c '${COMPRESS_SCRIPT.replace(/'/g, "'\"'\"'")}'`,
    { input: JSON.stringify({ e: embedding, b: bits }), maxBuffer: 1024 * 1024 }
  );
  
  const result = JSON.parse(stdout);
  
  // Pack into buffer: dim(4) + bits(1) + norm(8) + indices + signs
  const indices = Buffer.from(result.i, 'base64');
  const signs = Buffer.from(result.s, 'base64');
  const buffer = Buffer.alloc(21 + indices.length + signs.length);
  
  buffer.writeUInt32LE(result.d, 0);
  buffer.writeUInt8(result.b, 4);
  buffer.writeDoubleLE(result.r, 5);
  indices.copy(buffer, 13);
  signs.copy(buffer, 13 + indices.length);
  
  return buffer;
}

/**
 * Compute similarity between query and compressed embedding
 * Returns cosine similarity score [-1, 1]
 */
export async function similarity(query: number[], compressed: Buffer): Promise<number> {
  const dim = compressed.readUInt32LE(0);
  const bits = compressed.readUInt8(4);
  const norm = compressed.readDoubleLE(5);
  
  const indicesLen = Math.ceil(dim * bits / 8);
  const signsLen = Math.ceil(dim / 8);
  
  const indices = compressed.subarray(13, 13 + indicesLen).toString('base64');
  const signs = compressed.subarray(13 + indicesLen, 13 + indicesLen + signsLen).toString('base64');
  
  const { stdout } = await execAsync(
    `python3 -c '${SIMILARITY_SCRIPT.replace(/'/g, "'\"'\"'")}'`,
    { input: JSON.stringify({ q: query, i: indices, s: signs, r: norm, d: dim, b: bits }), maxBuffer: 1024 * 1024 }
  );
  
  return JSON.parse(stdout).s;
}

/**
 * Get compression stats
 */
export function stats(embeddingLength: number, bits: number = 3): {
  originalBytes: number;
  compressedBytes: number;
  ratio: number;
  savings: number;
} {
  const originalBytes = embeddingLength * 2; // FP16
  const compressedBytes = 13 + Math.ceil(embeddingLength * bits / 8) + Math.ceil(embeddingLength / 8);
  
  return {
    originalBytes,
    compressedBytes,
    ratio: originalBytes / compressedBytes,
    savings: 1 - (compressedBytes / originalBytes),
  };
}

// Export simple API
export default { compress, similarity, stats };