// Muninn v2 Robust Benchmark Runner
// - Rate limiting with exponential backoff
// - Checkpointing every conversation
// - Memory management
// - Graceful shutdown handling

import { Muninn } from './index-unified.js';
import { generateAnswer } from './answer-generation.js';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';

const DATASET_PATH = './benchmark/locomo10.json';
const DB_PATH = '/tmp/locomo-benchmark.db';
const CHECKPOINT_PATH = '/tmp/locomo-checkpoint.json';

const CATEGORY_NAMES: Record<number, string> = {
  1: 'single_hop',
  2: 'temporal',
  3: 'multi_hop',
  4: 'open_domain',
  5: 'unanswerable'
};

interface Checkpoint {
  conversationIndex: number;
  questionIndex: number;
  totalCorrect: number;
  totalScored: number;
  categoryStats: Record<number, { correct: number; total: number }>;
  startTime: number;
}

// Rate limiter with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  baseDelay: number = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      const isRateLimit = e.status === 429 || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT';
      
      if (!isRateLimit || attempt === maxRetries - 1) {
        throw e;
      }
      
      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`   ⏳ Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Max retries exceeded');
}

// Save checkpoint
function saveCheckpoint(checkpoint: Checkpoint): void {
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2));
}

// Load checkpoint
function loadCheckpoint(): Checkpoint | null {
  if (existsSync(CHECKPOINT_PATH)) {
    return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf-8'));
  }
  return null;
}

// Clear checkpoint
function clearCheckpoint(): void {
  if (existsSync(CHECKPOINT_PATH)) {
    unlinkSync(CHECKPOINT_PATH);
  }
}

// Score answer with flexible matching
function scoreAnswer(answer: string, expected: string): boolean {
  if (!answer || !expected) return false;
  
  const normalize = (s: string) => s.toLowerCase().trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ');
  
  const a = normalize(answer);
  const e = normalize(expected);
  
  if (a === e) return true;
  if (a.includes(e)) return true;
  if (e.includes(a)) return true;
  
  // Word overlap for partial credit
  const aWords = new Set(a.split(' '));
  const eWords = new Set(e.split(' '));
  const overlap = [...aWords].filter(w => eWords.has(w)).length;
  const minWords = Math.min(aWords.size, eWords.size);
  
  return minWords > 0 && overlap >= minWords * 0.7;
}

async function runBenchmark() {
  console.log('=== LOCOMO Benchmark - Robust Runner ===');
  console.log(`Started: ${new Date().toISOString()}\n`);
  
  // Load dataset
  const dataset = JSON.parse(readFileSync(DATASET_PATH, 'utf-8'));
  console.log(`Dataset: ${dataset.length} conversations`);
  
  // Pre-flight: count questions
  let totalQuestions = 0;
  let scorableQuestions = 0;
  for (const conv of dataset) {
    for (const qa of conv.qa) {
      totalQuestions++;
      if (qa.answer !== null && qa.answer !== undefined) {
        scorableQuestions++;
      }
    }
  }
  console.log(`Total questions: ${totalQuestions}`);
  console.log(`Scorable questions: ${scorableQuestions}`);
  console.log(`Skipped (no ground truth): ${totalQuestions - scorableQuestions}\n`);
  
  // Initialize or resume from checkpoint
  let checkpoint = loadCheckpoint();
  let startFromConv = 0;
  let startFromQ = 0;
  let totalCorrect = 0;
  let totalScored = 0;
  const categoryStats: Record<number, { correct: number; total: number }> = {
    1: { correct: 0, total: 0 },
    2: { correct: 0, total: 0 },
    3: { correct: 0, total: 0 },
    4: { correct: 0, total: 0 }
  };
  
  if (checkpoint) {
    console.log('📂 Resuming from checkpoint...');
    console.log(`   Conversation ${checkpoint.conversationIndex + 1}, Question ${checkpoint.questionIndex + 1}`);
    startFromConv = checkpoint.conversationIndex;
    startFromQ = checkpoint.questionIndex;
    totalCorrect = checkpoint.totalCorrect;
    totalScored = checkpoint.totalScored;
    Object.assign(categoryStats, checkpoint.categoryStats);
  }
  
  // Initialize Muninn
  const muninn = new Muninn(DB_PATH);
  
  // Handle graceful shutdown
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n\n⚠️ Graceful shutdown requested...');
    console.log(`   Progress: Conversation ${startFromConv + 1}, Question ${startFromQ}`);
    console.log(`   Accuracy so far: ${totalScored > 0 ? ((totalCorrect / totalScored) * 100).toFixed(1) : 0}%`);
    
    saveCheckpoint({
      conversationIndex: startFromConv,
      questionIndex: startFromQ,
      totalCorrect,
      totalScored,
      categoryStats,
      startTime: checkpoint?.startTime || Date.now()
    });
    
    muninn.close();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  // Process conversations
  for (let i = startFromConv; i < dataset.length && !shuttingDown; i++) {
    const conv = dataset[i];
    console.log(`\n📍 Conversation ${i + 1}/${dataset.length}: ${conv.id || 'conv-' + i}`);
    
    // Ingest conversation sessions
    const sessions = conv.sessions || [];
    console.log(`📚 Found ${sessions.length} sessions`);
    
    for (const session of sessions) {
      const sessionData = session.data || session;
      const sessionDate = sessionData.date || sessionData.session_date || conv.date || '2024-01-01';
      
      const speakerA = conv.speaker_a || 'A';
      const speakerB = conv.speaker_b || 'B';
      
      const content = sessionData.map((turn: any) => {
        const speaker = turn.speaker || (turn.speaker_name === 'a' ? speakerA : speakerB);
        const text = turn.text || turn.content || '';
        return `${speaker}: ${text}`;
      }).join('\n');
      
      try {
        await withRetry(() => muninn.remember(content, { source: 'locomo', sessionDate }));
      } catch (e: any) {
        console.log(`   ⚠️ Failed to remember session: ${e.message}`);
      }
    }
    
    // Process questions
    const qaList = conv.qa;
    let qIndex = (i === startFromConv) ? startFromQ : 0;
    
    for (let j = qIndex; j < qaList.length && !shuttingDown; j++) {
      const qa = qaList[j];
      const question = qa.question;
      
      // Defensive answer handling
      const expected = (() => {
        if (qa.answer === null || qa.answer === undefined) return '';
        if (Array.isArray(qa.answer)) return qa.answer.join(' ');
        if (typeof qa.answer === 'number') return String(qa.answer);
        return String(qa.answer);
      })();
      
      // Skip questions with no ground truth
      if (!expected) continue;
      
      const category = qa.category || 0;
      
      // Ensure category exists
      if (!categoryStats[category]) {
        categoryStats[category] = { correct: 0, total: 0 };
      }
      
      // Retrieve and answer
      let answer: string;
      try {
        const result = await withRetry(() => muninn.recall(question));
        answer = await withRetry(() => generateAnswer(question, result));
      } catch (e: any) {
        answer = "I don't have information about that.";
        console.log(`   ⚠️ Query failed: ${e.message}`);
      }
      
      // Score
      const passed = scoreAnswer(answer, expected);
      categoryStats[category].total++;
      totalScored++;
      
      if (passed) {
        categoryStats[category].correct++;
        totalCorrect++;
        console.log(`✅ [${CATEGORY_NAMES[category] || 'cat-' + category}] "${question.substring(0, 40)}..."`);
      } else {
        console.log(`❌ [${CATEGORY_NAMES[category] || 'cat-' + category}] "${question.substring(0, 40)}..."`);
      }
      
      // Update checkpoint tracking
      startFromQ = j + 1;
      
      // Small delay to prevent rate limiting
      await new Promise(r => setTimeout(r, 50));
    }
    
    // Checkpoint after each conversation
    startFromConv = i;
    startFromQ = 0;
    
    const duration = ((Date.now() - (checkpoint?.startTime || Date.now())) / 1000 / 60).toFixed(1);
    const accuracy = totalScored > 0 ? ((totalCorrect / totalScored) * 100).toFixed(1) : '0.0';
    console.log(`\n   Conversation ${i + 1} complete`);
    console.log(`   Running accuracy: ${accuracy}% (${totalCorrect}/${totalScored})`);
    console.log(`   Duration: ${duration} minutes`);
    
    saveCheckpoint({
      conversationIndex: i + 1,
      questionIndex: 0,
      totalCorrect,
      totalScored,
      categoryStats,
      startTime: checkpoint?.startTime || Date.now()
    });
    
    // Memory cleanup every 3 conversations
    if ((i + 1) % 3 === 0) {
      const stats = muninn.getStats();
      console.log(`   DB: ${stats.entityCount} entities, ${stats.observationCount} observations`);
    }
  }
  
  // Final results
  const totalDuration = ((Date.now() - (checkpoint?.startTime || Date.now())) / 1000 / 60).toFixed(1);
  
  console.log('\n=== Final Results ===');
  console.log(`Total Questions: ${totalQuestions}`);
  console.log(`Scorable Questions: ${scorableQuestions}`);
  console.log(`Questions Scored: ${totalScored}`);
  console.log(`Correct: ${totalCorrect}`);
  const accuracy = totalScored > 0 ? ((totalCorrect / totalScored) * 100).toFixed(1) : '0.0';
  console.log(`Accuracy: ${accuracy}%`);
  console.log(`Duration: ${totalDuration} minutes\n`);
  
  console.log('By Category:');
  for (let i = 1; i <= 4; i++) {
    const cat = categoryStats[i] || { correct: 0, total: 0 };
    const pct = cat.total > 0 ? ((cat.correct / cat.total) * 100).toFixed(1) : '0.0';
    console.log(`  ${i}. ${CATEGORY_NAMES[i]}: ${cat.correct}/${cat.total} (${pct}%)`);
  }
  
  console.log('\n=== Comparison to LOCOMO Baselines ===');
  console.log('  GPT-3.5 (conv): 24.5%');
  console.log('  GPT-4 (conv): 42.3%');
  console.log('  Mem0: 66.9%');
  console.log('  Engram: 79.6%');
  console.log(`  Muninn v2: ${accuracy}%\n`);
  
  // Save final results
  const results = {
    timestamp: new Date().toISOString(),
    totalQuestions,
    scorableQuestions,
    questionsScored: totalScored,
    correct: totalCorrect,
    accuracy: parseFloat(accuracy),
    categories: categoryStats,
    duration: totalDuration
  };
  
  writeFileSync('./benchmark-results-latest.json', JSON.stringify(results, null, 2));
  console.log('Results saved to benchmark-results-latest.json');
  
  // Clear checkpoint on success
  clearCheckpoint();
  
  muninn.close();
}

runBenchmark().catch(e => {
  console.error('Benchmark failed:', e);
  process.exit(1);
});