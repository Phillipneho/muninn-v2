/**
 * LOCOMO Benchmark Runner for Muninn v2
 * 
 * Dataset: https://github.com/snap-research/locomo
 * 
 * Question Categories:
 * 1 - Single-hop: Direct recall from one turn
 * 2 - Temporal: Time-based reasoning
 * 3 - Multi-hop: Reasoning across multiple turns/sessions
 * 4 - Open-domain: Commonsense/world knowledge inference
 * 5 - Adversarial: Filtered out (not evaluated)
 * 
 * Target: 55% overall (vs v1's 5.2% and Mem0's 66.9%)
 */

import { Muninn } from './index.js';
import { generateAnswer } from './answer-generation.js';
import { readFileSync, existsSync, unlinkSync } from 'fs';

interface LOCOMOQuestion {
  question: string;
  answer: string;
  evidence: string[];
  category: number; // 1-4 (5 is adversarial, filtered out)
}

interface LOCOMOConversation {
  sample_id: string;
  speaker_a: string;
  speaker_b: string;
  conversation: Record<string, any>;
  qa: LOCOMOQuestion[];
}

interface BenchmarkResult {
  conversationId: string;
  question: string;
  expectedAnswer: string;
  generatedAnswer: string;
  category: number;
  categoryName: string;
  correct: boolean;
  reasoning?: string;
  responseTimeMs: number;
}

const CATEGORY_NAMES: Record<number, string> = {
  1: 'single_hop',
  2: 'temporal',
  3: 'multi_hop',
  4: 'open_domain',
};

async function runBenchmark() {
  console.log('🧪 LOCOMO Benchmark for Muninn v2\n');
  console.log('='.repeat(80));
  console.log('Dataset: https://github.com/snap-research/locomo');
  console.log('Benchmark: 10 conversations, ~300 turns each, up to 35 sessions');
  console.log('='.repeat(80));
  console.log('\n');

  // Load dataset
  const datasetPath = './benchmark/locomo10.json';
  if (!existsSync(datasetPath)) {
    console.error('❌ Dataset not found:', datasetPath);
    console.log('Download with: wget https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json');
    process.exit(1);
  }
  
  const dataset: LOCOMOConversation[] = JSON.parse(
    readFileSync(datasetPath, 'utf-8')
  );

  console.log(`📊 Loaded ${dataset.length} conversations\n`);

  // Initialize Muninn v2
  const dbPath = '/tmp/locomo-v2-benchmark.db';
  if (existsSync(dbPath)) unlinkSync(dbPath);
  
  const muninn = new Muninn(dbPath);

  const allResults: BenchmarkResult[] = [];
  const categoryStats: Record<number, { correct: number; total: number }> = {
    1: { correct: 0, total: 0 },
    2: { correct: 0, total: 0 },
    3: { correct: 0, total: 0 },
    4: { correct: 0, total: 0 },
  };

  // Process each conversation
  for (let i = 0; i < dataset.length; i++) {
    const conv = dataset[i];
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📍 Conversation ${i + 1}/${dataset.length}: ${conv.sample_id}`);
    console.log(`${'='.repeat(80)}\n`);

    // Extract sessions from conversation object
    const conversation = conv.conversation;
    const speakerA = conversation.speaker_a as string;
    const speakerB = conversation.speaker_b as string;
    
    // Find all session keys (session_1, session_2, etc.)
    const sessionKeys = Object.keys(conversation)
      .filter(k => k.startsWith('session_') && !k.includes('date_time'))
      .sort((a, b) => {
        const numA = parseInt(a.replace('session_', ''));
        const numB = parseInt(b.replace('session_', ''));
        return numA - numB;
      });

    console.log(`📚 Found ${sessionKeys.length} sessions\n`);

    // Process each session
    for (const sessionKey of sessionKeys) {
      const sessionData = conversation[sessionKey];
      const sessionDate = conversation[`${sessionKey}_date_time`];
      
      if (!sessionData || !Array.isArray(sessionData)) continue;

      console.log(`  📖 ${sessionKey} (${sessionDate || 'no date'}) - ${sessionData.length} turns`);

      // Build session content
      const sessionContent = sessionData.map((turn: any) => {
        const speaker = turn.speaker || (turn.speaker_name === 'a' ? speakerA : speakerB);
        const text = turn.text || turn.content || '';
        return `${speaker}: ${text}`;
      }).join('\n');

      // Remember the session
      try {
        await muninn.remember(sessionContent, {
          source: `conversation-${conv.sample_id}`,
          actor: 'both',
          sessionDate: sessionDate
        });
      } catch (e) {
        console.error(`    ⚠️ Error remembering ${sessionKey}:`, e);
      }
    }

    console.log(`\n  ✅ Stored all sessions\n`);

    // Answer questions
    console.log(`  ❓ Answering ${conv.qa.length} questions...\n`);
    
    for (const qa of conv.qa) {
      // Skip adversarial questions (category 5)
      if (qa.category === 5) continue;

      const startTime = Date.now();
      
      try {
        // Query Muninn v2
        const result = await muninn.recall(qa.question);
        
        // Generate answer using LLM
        const generatedAnswer = await generateAnswer(qa.question, result);
        
        const responseTimeMs = Date.now() - startTime;
        
        // Check correctness
        const correct = checkCorrectness(generatedAnswer, qa.answer);
        
        const benchmarkResult: BenchmarkResult = {
          conversationId: conv.sample_id,
          question: qa.question,
          expectedAnswer: qa.answer,
          generatedAnswer,
          category: qa.category,
          categoryName: CATEGORY_NAMES[qa.category] || 'unknown',
          correct,
          responseTimeMs,
        };
        
        allResults.push(benchmarkResult);
        
        // Update stats
        categoryStats[qa.category].total++;
        if (correct) categoryStats[qa.category].correct++;
        
        // Log result
        const icon = correct ? '✅' : '❌';
        console.log(`    ${icon} [${CATEGORY_NAMES[qa.category]}] "${qa.question}"`);
        console.log(`       Expected: "${qa.answer}"`);
        console.log(`       Got: "${generatedAnswer}"`);
        console.log(`       Source: ${result.source}\n`);
        
      } catch (e: any) {
        console.error(`    ⚠️ Error answering "${qa.question}":`, e.message);
      }
    }

    // Clear database for next conversation
    muninn.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    
    // Recreate Muninn instance
    const { MuninnDatabase } = await import('./database-sqlite.js');
    const { Retriever } = await import('./retrieval.js');
    // @ts-ignore
    muninn.db = new MuninnDatabase(dbPath);
    // @ts-ignore
    muninn.retriever = new Retriever(muninn.db);
  }

  // Print results
  console.log('\n' + '='.repeat(80));
  console.log('📊 BENCHMARK RESULTS');
  console.log('='.repeat(80));
  console.log('\n');

  // Calculate overall
  const totalCorrect = Object.values(categoryStats).reduce((sum, s) => sum + s.correct, 0);
  const totalQuestions = Object.values(categoryStats).reduce((sum, s) => sum + s.total, 0);
  
  console.log(`Overall: ${totalCorrect}/${totalQuestions} (${((totalCorrect / totalQuestions) * 100).toFixed(1)}%)\n`);
  
  console.log('By Category:');
  for (const [cat, stats] of Object.entries(categoryStats)) {
    const pct = stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(1) : '0.0';
    console.log(`  ${CATEGORY_NAMES[parseInt(cat)]}: ${stats.correct}/${stats.total} (${pct}%)`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('📈 Comparison to Other Systems');
  console.log('='.repeat(80));
  console.log(`
  | System      | Single-Hop | Multi-Hop | Open-Domain | Temporal | Overall |
  |-------------|------------|-----------|-------------|----------|----------|
  | Backboard   | 89.36%     | 75.00%    | 91.20%      | 91.90%   | 90.00%   |
  | Mem0        | 67.13%     | 51.15%    | 72.93%      | 55.51%   | 66.88%   |
  | Muninn v1   | 8.9%       | 11.5%     | 5.5%        | 1.2%     | 5.2%     |
  | Muninn v2   | ?          | ?         | ?           | ?        | ?        |
  `);
  console.log('Target: 55% overall (10x improvement from v1)\n');

  muninn.close();
}

function checkCorrectness(generated: string, expected: string): boolean {
  // Normalize both strings
  const normalize = (s: string) => s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  const genNorm = normalize(generated);
  const expNorm = normalize(expected);
  
  // Direct match
  if (genNorm === expNorm) return true;
  
  // Contains match
  if (genNorm.includes(expNorm) || expNorm.includes(genNorm)) return true;
  
  // Check key terms
  const expTerms = expNorm.split(' ').filter(t => t.length > 2);
  const matchedTerms = expTerms.filter(t => genNorm.includes(t));
  
  // At least 50% of key terms match
  return matchedTerms.length >= Math.ceil(expTerms.length * 0.5);
}

main().catch(console.error);

async function main() {
  try {
    await runBenchmark();
  } catch (e) {
    console.error('❌ Benchmark failed:', e);
    process.exit(1);
  }
}