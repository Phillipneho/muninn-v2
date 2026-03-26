/**
 * Embedding Utilities for Muninn
 * 
 * Handles compression/decompression and storage operations for embeddings.
 */

import { TurboQuantStore, getTurboQuantStore } from './turboquant-store.js';

// Configuration
const DEFAULT_BITS = parseInt(process.env.TURBOQUANT_BITS || '3');

/**
 * Serialize embedding to Buffer (FP16 format)
 */
export function serializeEmbeddingFP16(embedding: number[]): Buffer {
  const buffer = Buffer.alloc(embedding.length * 2);
  for (let i = 0; i < embedding.length; i++) {
    // Convert to float16 (simplified - use float32 for now)
    buffer.writeFloatLE(embedding[i], i * 4);
  }
  // Resize to actual float16 size
  return buffer.subarray(0, embedding.length * 2);
}

/**
 * Deserialize embedding from Buffer (FP16 format)
 */
export function deserializeEmbeddingFP16(buffer: Buffer, dimension: number): number[] {
  const embedding: number[] = [];
  for (let i = 0; i < dimension; i++) {
    // Read as float32 for simplicity
    embedding.push(buffer.readFloatLE(i * 4));
  }
  return embedding;
}

/**
 * Serialize compressed embedding to Buffer
 * 
 * Format:
 * - 4 bytes: dimension (uint32 LE)
 * - 1 byte: bits (uint8)
 * - 8 bytes: residual_norm (float64 LE)
 * - 8 bytes: original_norm (float64 LE)
 * - N bytes: mse_indices
 * - M bytes: qjl_signs
 */
export function serializeCompressedEmbedding(compressed: {
  mse_indices: string;  // base64
  qjl_signs: string;    // base64
  residual_norm: number;
  bits: number;
  dimension: number;
}): Buffer {
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

/**
 * Deserialize compressed embedding from Buffer
 */
export function deserializeCompressedEmbedding(buffer: Buffer): {
  mse_indices: string;  // base64
  qjl_signs: string;    // base64
  residual_norm: number;
  bits: number;
  dimension: number;
} {
  let offset = 0;
  
  const dimension = buffer.readUInt32LE(offset); offset += 4;
  const bits = buffer.readUInt8(offset); offset += 1;
  const residual_norm = buffer.readDoubleLE(offset); offset += 8;
  const _original_norm = buffer.readDoubleLE(offset); offset += 8; // unused
  
  const mseIndicesLength = Math.ceil(dimension * bits / 8);
  const qjlSignsLength = Math.ceil(dimension / 8);
  
  const mseIndices = buffer.subarray(offset, offset + mseIndicesLength);
  offset += mseIndicesLength;
  const qjlSigns = buffer.subarray(offset, offset + qjlSignsLength);
  
  return {
    mse_indices: mseIndices.toString('base64'),
    qjl_signs: qjlSigns.toString('base64'),
    residual_norm,
    bits,
    dimension,
  };
}

/**
 * Check if embedding is compressed
 */
export function isCompressedEmbedding(buffer: Buffer): boolean {
  // Compressed format has metadata at the start
  // Minimum size: 4 (dimension) + 1 (bits) + 8 (residual_norm) + 8 (original_norm) = 21 bytes
  if (buffer.length < 21) return false;
  
  // Check if bits value is reasonable (1-8)
  const bits = buffer.readUInt8(4);
  return bits >= 1 && bits <= 8;
}

/**
 * Get embedding metadata from Buffer
 */
export function getEmbeddingMetadata(buffer: Buffer): {
  compressed: boolean;
  dimension: number;
  bits: number;
  size: number;
} {
  if (!isCompressedEmbedding(buffer)) {
    // Assume FP16 format
    return {
      compressed: false,
      dimension: buffer.length / 2,
      bits: 16,
      size: buffer.length,
    };
  }
  
  const dimension = buffer.readUInt32LE(0);
  const bits = buffer.readUInt8(4);
  
  return {
    compressed: true,
    dimension,
    bits,
    size: buffer.length,
  };
}

/**
 * Compress an embedding using TurboQuant
 */
export async function compressEmbedding(
  embedding: number[],
  bits: number = DEFAULT_BITS
): Promise<Buffer> {
  const store = getTurboQuantStore({ dimension: embedding.length, bits });
  const compressed = await store.compress(embedding);
  return serializeCompressedEmbedding(compressed);
}

/**
 * Compute similarity between query and stored embedding
 * Handles both compressed and uncompressed formats
 */
export async function computeSimilarity(
  query: number[],
  storedBuffer: Buffer
): Promise<number> {
  if (!isCompressedEmbedding(storedBuffer)) {
    // Uncompressed FP16 - compute directly
    const stored = deserializeEmbeddingFP16(storedBuffer, query.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < query.length; i++) {
      dot += query[i] * stored[i];
      normA += query[i] * query[i];
      normB += stored[i] * stored[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  // Compressed - use TurboQuant
  const compressed = deserializeCompressedEmbedding(storedBuffer);
  const store = getTurboQuantStore({
    dimension: compressed.dimension,
    bits: compressed.bits,
  });
  
  return store.innerProduct(query, compressed);
}

/**
 * Get storage statistics
 */
export function getStorageStats(embeddings: Buffer[]): {
  totalBytes: number;
  compressedCount: number;
  uncompressedCount: number;
  compressionRatio: number;
  savings: number;
} {
  let compressedCount = 0;
  let uncompressedCount = 0;
  let totalBytes = 0;
  
  for (const buffer of embeddings) {
    totalBytes += buffer.length;
    if (isCompressedEmbedding(buffer)) {
      compressedCount++;
    } else {
      uncompressedCount++;
    }
  }
  
  // Estimate what size would be without compression
  const uncompressedSize = compressedCount * 768 * 2 + uncompressedCount * 768 * 2;
  
  return {
    totalBytes,
    compressedCount,
    uncompressedCount,
    compressionRatio: uncompressedSize / totalBytes,
    savings: 1 - (totalBytes / uncompressedSize),
  };
}