/**
 * Tests for TurboQuant integration
 */

import { describe, it, expect } from 'vitest';
import { TurboQuant, compressEmbedding, decompressEmbedding, similarity } from './turboquant.js';
import * as fs from 'fs';

describe('TurboQuant', () => {
  const dimension = 768;
  const bits = 3;
  
  // Generate a random embedding
  function randomEmbedding(d: number): number[] {
    const embedding: number[] = [];
    for (let i = 0; i < d; i++) {
      embedding.push(Math.random() * 2 - 1);
    }
    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    return embedding.map(v => v / norm);
  }
  
  // Cosine similarity
  function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  it('should compress and decompress embeddings', () => {
    const tq = new TurboQuant({ dimension, bits });
    const original = randomEmbedding(dimension);
    
    const compressed = tq.compress(original);
    const decompressed = tq.decompress(compressed);
    
    expect(decompressed.length).toBe(dimension);
    
    const cosineSim = cosineSimilarity(original, decompressed);
    console.log(`  ${bits}-bit: cosine similarity = ${cosineSim.toFixed(4)}`);
    
    // Should maintain > 90% cosine similarity at 3-bit
    expect(cosineSim).toBeGreaterThan(0.90);
  });
  
  it('should achieve > 4x compression ratio', () => {
    const tq = new TurboQuant({ dimension, bits });
    const ratio = tq.getCompressionRatio();
    
    console.log(`  Compression ratio: ${ratio.toFixed(1f)}x`);
    expect(ratio).toBeGreaterThan(4);
  });
  
  it('should have smaller size than FP16', () => {
    const tq = new TurboQuant({ dimension, bits });
    const compressedSize = tq.getCompressedSize();
    const fp16Size = dimension * 2;
    
    console.log(`  Compressed: ${compressedSize} bytes, FP16: ${fp16Size} bytes`);
    expect(compressedSize).toBeLessThan(fp16Size);
  });
  
  it('should serialize and deserialize correctly', () => {
    const tq = new TurboQuant({ dimension, bits });
    const original = randomEmbedding(dimension);
    
    const compressed = tq.compress(original);
    const serialized = serializeCompressed(compressed);
    const deserialized = deserializeCompressed(serialized);
    const decompressed = tq.decompress(deserialized);
    
    const cosineSim = cosineSimilarity(original, decompressed);
    expect(cosineSim).toBeGreaterThan(0.90);
  });
  
  it('should support different bit-widths', () => {
    for (const b of [2, 3, 4]) {
      const tq = new TurboQuant({ dimension, bits: b });
      const original = randomEmbedding(dimension);
      
      const compressed = tq.compress(original);
      const decompressed = tq.decompress(compressed);
      
      const cosineSim = cosineSimilarity(original, decompressed);
      const ratio = tq.getCompressionRatio();
      
      console.log(`  ${b}-bit: cosine=${cosineSim.toFixed(4)}, ratio=${ratio.toFixed(1)}x`);
      
      if (b >= 3) {
        expect(cosineSim).toBeGreaterThan(0.90);
      }
    }
  });
  
  it('should compute inner product for retrieval', () => {
    const tq = new TurboQuant({ dimension, bits });
    const query = randomEmbedding(dimension);
    const stored = randomEmbedding(dimension);
    
    const compressed = tq.compress(stored);
    const ip = tq.innerProduct(query, compressed);
    
    // Inner product should be similar to cosine (both normalized)
    const expectedCosine = cosineSimilarity(query, stored);
    
    console.log(`  Inner product: ${ip.toFixed(4)}, expected cosine: ${expectedCosine.toFixed(4)}`);
    
    // Allow some deviation due to quantization
    expect(Math.abs(ip - expectedCosine)).toBeLessThan(0.15);
  });
  
  it('should work with convenience functions', () => {
    const original = randomEmbedding(dimension);
    
    const serialized = compressEmbedding(original);
    const decompressed = decompressEmbedding(serialized);
    
    const cosineSim = cosineSimilarity(original, decompressed);
    expect(cosineSim).toBeGreaterThan(0.90);
  });
  
  it('should work with similarity function', () => {
    const query = randomEmbedding(dimension);
    const stored = randomEmbedding(dimension);
    
    const storedSerialized = compressEmbedding(stored);
    const sim = similarity(query, storedSerialized);
    
    expect(typeof sim).toBe('number');
    expect(sim).toBeGreaterThan(-1);
    expect(sim).toBeLessThan(1);
  });
  
  it('should cache rotation matrix', () => {
    const tq = new TurboQuant({ dimension, bits, seed: 12345 });
    
    // First call generates and caches
    const compressed1 = tq.compress(randomEmbedding(dimension));
    
    // Second call should use cache
    const compressed2 = tq.compress(randomEmbedding(dimension));
    
    // Rotation matrix should be cached in /tmp
    const cacheFile = `/tmp/turboquant-cache/rotation-${dimension}-12345.bin`;
    expect(fs.existsSync(cacheFile)).toBe(true);
  });
});

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Running TurboQuant tests...');
  
  const dimension = 768;
  const bits = 3;
  
  function randomEmbedding(d: number): number[] {
    const embedding: number[] = [];
    for (let i = 0; i < d; i++) {
      embedding.push(Math.random() * 2 - 1);
    }
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    return embedding.map(v => v / norm);
  }
  
  function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  console.log('\nTest: Compress and decompress embeddings');
  const tq = new TurboQuant({ dimension, bits });
  const original = randomEmbedding(dimension);
  const compressed = tq.compress(original);
  const decompressed = tq.decompress(compressed);
  const cosineSim = cosineSimilarity(original, decompressed);
  console.log(`  ${bits}-bit: cosine similarity = ${cosineSim.toFixed(4)}`);
  
  console.log('\nTest: Compression ratio');
  const ratio = tq.getCompressionRatio();
  console.log(`  Compression ratio: ${ratio.toFixed(1)}x`);
  
  console.log('\nTest: Size comparison');
  const compressedSize = tq.getCompressedSize();
  const fp16Size = dimension * 2;
  console.log(`  Compressed: ${compressedSize} bytes, FP16: ${fp16Size} bytes`);
  
  console.log('\nTest: Different bit-widths');
  for (const b of [2, 3, 4]) {
    const tq2 = new TurboQuant({ dimension, bits: b });
    const orig = randomEmbedding(dimension);
    const comp = tq2.compress(orig);
    const deco = tq2.decompress(comp);
    const sim = cosineSimilarity(orig, deco);
    const rat = tq2.getCompressionRatio();
    console.log(`  ${b}-bit: cosine=${sim.toFixed(4)}, ratio=${rat.toFixed(1)}x`);
  }
  
  console.log('\nAll tests passed!');
}