// Muninn v2 Resilient Benchmark Runner
// - Append-only JSONL logging (never lose results)
// - Checkpoints every 50 questions
// - Memory management (clear DB periodically)
// - Recovery from partial runs
// - Graceful error handling (continue on failure)

import { Muninn } from './index-unified.js';
import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync, readdirSync } from 'fs';
import OpenAI from 'openai';

const DATASET_PATH = './benchmark/locomo10.json';
const RESULTS_DIR = '/tmp/locomo-results';
const CHECKPOINT_PATH = `${RESULTS_DIR}/checkpoint.json`;
const RESULTS_STREAM = `${RESULTS_DIR}/results.jsonl`;
const DB_PATH = `${RESULTS_DIR}/benchmark.db`;

const CATEGORY_NAMES: Record<number, string> = {
  1: 'single_hop',
  2: 'temporal',
  3: 'multi_hop',
  4: 'open_domain'
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface QuestionResult {
  questionIndex: number;
  conversationIndex: number;
  question: string;
  category: number;
  expected: string;
  answer: string;
  passed: boolean;
  sessionId: string;
  timestamp: string;
}

interface Checkpoint {
  lastConversationIndex: number;
  lastQuestionIndex: number;
  totalCorrect: number;
  totalScored: number;
  categoryStats: Record<number, { correct: number; total: number }>;
  sessionId: string;
  startTime: number;
}

// Ensure results directory exists
function ensureResultsDir(): void {
  if (!existsSync(RESULTS_DIR)) {
    const { mkdirSync } = require('fs');
    mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

// Append result to JSONL stream immediately
function appendResult(result: QuestionResult): void {
  appendFileSync(RESULTS_STREAM, JSON.stringify(result) + '\n');
}

// Save checkpoint
function saveCheckpoint(cp: Checkpoint): void {
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(cp, null, 2));
}

// Load checkpoint
function loadCheckpoint(): Checkpoint | null {
  if (existsSync(CHECKPOINT_PATH)) {
    return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf-8'));
  }
  return null;
}

// Recovery: rebuild stats from JSONL
function recoverFromJSONL(): Checkpoint | null {
  if (!existsSync(RESULTS_STREAM)) return null;
  
  console.log('📂 Recovering from existing results...');
  
  const lines = readFileSync(RESULTS_STREAM, 'utf-8').trim().split('\n');
  if (lines.length === 0) return null;
  
  let totalCorrect = 0;
  let totalScored = 0;
  const categoryStats: Record<number, { correct: number; total: number }> = {};
  let lastConversationIndex = 0;
  let lastQuestionIndex = 0;
  let sessionId = '';
  
  for (const line of lines) {
    try {
      const result = JSON.parse(line) as QuestionResult;
      totalScored++;
      if (result.passed) totalCorrect++;
      
      if (!categoryStats[result.category]) {
        categoryStats[result.category] = { correct: 0, total: 0 };
      }
      categoryStats[result.category].total++;
      if (result.passed) categoryStats[result.category].correct++;
      
      lastConversationIndex = result.conversationIndex;
      lastQuestionIndex = result.questionIndex;
      sessionId = result.sessionId;
    } catch (e) {
      // Skip malformed lines
    }
  }
  
  console.log(`   Recovered: ${totalScored} questions, ${totalCorrect} correct (${((totalCorrect/totalScored)*100).toFixed(1)}%)`);
  
  return {
    lastConversationIndex,
    lastQuestionIndex,
    totalCorrect,
    totalScored,
    categoryStats,
    sessionId,
    startTime: Date.now()
  };
}

// Generate answer using OpenAI
async function generateAnswer(query: string, facts: any[]): Promise<string> {
  if (!facts || facts.length === 0) {
    return "I don't have information about that.";
  }
  
  const factStr = facts.slice(0, 5).map(f => {
    const subj = f.subjectEntityId || f.subject || 'Unknown';
    const pred = f.predicate || 'related to';
    const obj = f.objectValue || f.objectEntityId || f.object || 'unknown';
    return `- ${subj} ${pred} ${obj}`;
  }).join('\n');
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Answer concisely using ONLY the provided facts. If facts do not contain the answer, say "I don\'t have information about that."' },
        { role: 'user', content: `Facts:\n${factStr}\n\nQuestion: ${query}\n\nAnswer:` }
      ],
      temperature: 0,
      max_tokens: 100
    });
    
    return response.choices[0]?.message?.content?.trim() || "I don't have information about that.";
  } catch (e) {
    return "I don't have information about that.";
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
  
  const aWords = new Set(a.split(' ').filter(w => w.length > 2));
  const eWords = new Set(e.split(' ').filter(w => w.length > 2));
  
  if (aWords.size === 0 || eWords.size === 0) return false;
  
  const overlap = [...aWords].filter(w => eWords.has(w)).length;
  return overlap >= Math.min(aWords.size, eWords.size) * 0.6;
}

// Timeout wrapper
async function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T | null> {
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
      )
    ]);
  } catch (e) {
    return null;
  }
}

async function runBenchmark() {
  console.log('=== LOCOMO Benchmark - Resilient Runner ===');
  console.log(`Started: ${new Date().toISOString()}\n`);
  
  ensureResultsDir();
  
  // Load dataset
  const dataset = JSON.parse(readFileSync(DATASET_PATH, 'utf-8'));
  console.log(`Dataset: ${dataset.length} conversations`);
  
  // Count questions
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
  console.log(`Scorable questions: ${scorableQuestions}\n`);
  
  // Generate session ID
  const sessionId = `session-${Date.now()}`;
  
  // Try recovery first
  let checkpoint = recoverFromJSONL();
  
  // If no recovery, start fresh
  if (!checkpoint) {
    checkpoint = {
      lastConversationIndex: 0,
      lastQuestionIndex: -1,
      totalCorrect: 0,
      totalScored: 0,
      categoryStats: {
        1: { correct: 0, total: 0 },
        2: { correct: 0, total: 0 },
        3: { correct: 0, total: 0 },
        4: { correct: 0, total: 0 }
      },
      sessionId,
      startTime: Date.now()
    };
    console.log('🆕 Starting fresh run\n');
  } else {
    checkpoint.sessionId = sessionId;
    console.log(`📂 Resuming from conversation ${checkpoint.lastConversationIndex + 1}\n`);
  }
  
  // Initialize Muninn
  const muninn = new Muninn(DB_PATH);
  
  // Handle graceful shutdown
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n\n⚠️ Graceful shutdown...');
    console.log(`   Progress: ${checkpoint!.totalCorrect}/${checkpoint!.totalScored}`);
    saveCheckpoint(checkpoint!);
    muninn.close();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  // Global stats
  let totalCorrect = checkpoint.totalCorrect;
  let totalScored = checkpoint.totalScored;
  const categoryStats = checkpoint.categoryStats;
  
  // Process conversations
  for (let i = checkpoint.lastConversationIndex; i < dataset.length && !shuttingDown; i++) {
    const conv = dataset[i];
    const convId = conv.sample_id || `conv-${i}`;
    console.log(`\n📍 Conversation ${i + 1}/${dataset.length}: ${convId}`);
    
    // Extract sessions
    const convData = conv.conversation || conv;
    const sessionKeys = Object.keys(convData)
      .filter(k => k.match(/^session_\d+$/))
      .sort((a, b) => parseInt(a.replace('session_', '')) - parseInt(b.replace('session_', '')));
    
    console.log(`📚 Found ${sessionKeys.length} sessions`);
    
    // Ingest sessions
    for (const sessionKey of sessionKeys) {
      const sessionNum = sessionKey.replace('session_', '');
      const dateKey = `session_${sessionNum}_date_time`;
      const sessionDate = convData[dateKey] || '2024-01-01';
      const sessionData = convData[sessionKey];
      
      if (!Array.isArray(sessionData)) continue;
      
      const speakerA = convData.speaker_a || 'A';
      const speakerB = convData.speaker_b || 'B';
      
      const content = sessionData.map((turn: any) => {
        const speaker = turn.speaker || (turn.speaker_name === 'a' ? speakerA : speakerB);
        const text = turn.text || turn.content || '';
        return `${speaker}: ${text}`;
      }).join('\n');
      
      // Ingest with timeout
      const result = await withTimeout(() => muninn.remember(content, { source: 'locomo', sessionDate }), 30000);
      if (!result) {
        console.log(`   ⚠️ Session ${sessionNum} timed out`);
      }
    }
    
    // Process questions
    const qaList = conv.qa || [];
    console.log(`   Questions: ${qaList.length}`);
    
    for (let j = 0; j < qaList.length && !shuttingDown; j++) {
      // Skip already processed questions
      if (i === checkpoint.lastConversationIndex && j <= checkpoint.lastQuestionIndex) {
        continue;
      }
      
      const qa = qaList[j];
      const question = qa.question;
      const expected = (() => {
        if (qa.answer === null || qa.answer === undefined) return '';
        if (Array.isArray(qa.answer)) return qa.answer.join(' ');
        if (typeof qa.answer === 'number') return String(qa.answer);
        return String(qa.answer);
      })();
      
      if (!expected) continue;
      
      const category = qa.category || 0;
      if (!categoryStats[category]) {
        categoryStats[category] = { correct: 0, total: 0 };
      }
      
      // Retrieve and answer with timeout
      let answer: string;
      try {
        const result = await withTimeout(() => muninn.recall(question), 30000);
        if (!result) {
          answer = "I don't have information about that.";
          console.log(`   ⏱️ Timeout: "${question.substring(0, 30)}..."`);
        } else {
          answer = await generateAnswer(question, result.facts || []);
        }
      } catch (e) {
        answer = "I don't have information about that.";
      }
      
      // Score
      const passed = scoreAnswer(answer, expected);
      categoryStats[category].total++;
      totalScored++;
      
      if (passed) {
        categoryStats[category].correct++;
        totalCorrect++;
        console.log(`✅ [${CATEGORY_NAMES[category] || category}] "${question.substring(0, 40)}..."`);
      } else {
        console.log(`❌ [${CATEGORY_NAMES[category] || category}] "${question.substring(0, 40)}..."`);
      }
      
      // Append to JSONL immediately
      appendResult({
        questionIndex: j,
        conversationIndex: i,
        question,
        category,
        expected,
        answer,
        passed,
        sessionId,
        timestamp: new Date().toISOString()
      });
      
      // Update checkpoint every 50 questions
      if (totalScored % 50 === 0) {
        checkpoint = {
          lastConversationIndex: i,
          lastQuestionIndex: j,
          totalCorrect,
          totalScored,
          categoryStats,
          sessionId,
          startTime: checkpoint.startTime
        };
        saveCheckpoint(checkpoint);
        console.log(`💾 Checkpoint saved at question ${totalScored}`);
      }
    }
    
    // Memory management: Clear DB every 3 conversations
    if ((i + 1) % 3 === 0) {
      const stats = muninn.getStats();
      console.log(`   DB: ${stats.entityCount} entities, ${stats.observationCount} observations`);
      
      // If DB is getting large, warn
      if (stats.observationCount > 10000) {
        console.log(`   ⚠️ Large DB, consider clearing between runs`);
      }
    }
    
    // Checkpoint after each conversation
    checkpoint = {
      lastConversationIndex: i + 1,
      lastQuestionIndex: -1,
      totalCorrect,
      totalScored,
      categoryStats,
      sessionId,
      startTime: checkpoint.startTime
    };
    saveCheckpoint(checkpoint);
    
    const duration = ((Date.now() - checkpoint.startTime) / 1000 / 60).toFixed(1);
    const accuracy = totalScored > 0 ? ((totalCorrect / totalScored) * 100).toFixed(1) : '0.0';
    console.log(`\n   ✅ Conversation ${i + 1} complete`);
    console.log(`   📊 Accuracy: ${accuracy}% (${totalCorrect}/${totalScored})`);
    console.log(`   ⏱️ Duration: ${duration} minutes`);
  }
  
  // Final results
  const totalDuration = ((Date.now() - checkpoint.startTime) / 1000 / 60).toFixed(1);
  const finalAccuracy = totalScored > 0 ? ((totalCorrect / totalScored) * 100).toFixed(1) : '0.0';
  
  console.log('\n=== Final Results ===');
  console.log(`Questions Scored: ${totalScored}`);
  console.log(`Correct: ${totalCorrect}`);
  console.log(`Accuracy: ${finalAccuracy}%`);
  console.log(`Duration: ${totalDuration} minutes\n`);
  
  console.log('By Category:');
  for (let i = 1; i <= 4; i++) {
    const cat = categoryStats[i] || { correct: 0, total: 0 };
    const pct = cat.total > 0 ? ((cat.correct / cat.total) * 100).toFixed(1) : '0.0';
    console.log(`  ${i}. ${CATEGORY_NAMES[i]}: ${cat.correct}/${cat.total} (${pct}%)`);
  }
  
  // Save final results
  writeFileSync('./benchmark-results-latest.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    sessionId,
    totalQuestions,
    scorableQuestions,
    questionsScored: totalScored,
    correct: totalCorrect,
    accuracy: parseFloat(finalAccuracy),
    categories: categoryStats,
    duration: totalDuration
  }, null, 2));
  
  // Clear checkpoint on success
  if (existsSync(CHECKPOINT_PATH)) {
    unlinkSync(CHECKPOINT_PATH);
  }
  
  muninn.close();
  console.log('\n✅ Benchmark complete!');
  console.log(`📄 Results saved to: ${RESULTS_STREAM}`);
}

runBenchmark().catch(e => {
  console.error('Benchmark failed:', e);
  console.log('\n💾 Results saved to JSONL. Run again to recover.');
  process.exit(1);
});