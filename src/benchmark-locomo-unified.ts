// LOCOMO Benchmark - Unified Observations Architecture
// Full 10 conversations, ~1986 questions
// Uses Muninn v2.1 with tagged observations

import { Muninn } from './index-unified.js';
import { generateAnswer } from './answer-generation.js';
import { readFileSync, existsSync, unlinkSync } from 'fs';

const datasetPath = './benchmark/locomo10.json';
const dataset = JSON.parse(readFileSync(datasetPath, 'utf-8'));

const dbPath = '/tmp/locomo-unified-benchmark.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

const CATEGORY_NAMES: Record<number, string> = {
  1: 'single_hop',
  2: 'temporal',
  3: 'multi_hop',
  4: 'open_domain'
};

async function runBenchmark() {
  console.log('=== LOCOMO Benchmark - Unified Observations ===\n');
  console.log(`Testing ${dataset.length} conversations\n`);
  
  const categoryStats: Record<number, { correct: number; total: number }> = {
    1: { correct: 0, total: 0 },
    2: { correct: 0, total: 0 },
    3: { correct: 0, total: 0 },
    4: { correct: 0, total: 0 }
  };
  
  let totalCorrect = 0;
  let totalQuestions = 0;
  let skippedQuestions = 0;
  const startTime = Date.now();
  
  for (let i = 0; i < dataset.length; i++) {
    const conv = dataset[i];
    const convStart = Date.now();
    console.log(`\n📍 Conversation ${i + 1}/${dataset.length}: ${conv.sample_id}`);
    
    const conversation = conv.conversation;
    const sessionKeys = Object.keys(conversation)
      .filter(k => k.startsWith('session_') && !k.includes('date_time'))
      .sort((a, b) => parseInt(a.replace('session_', '')) - parseInt(b.replace('session_', '')));
    
    console.log(`📚 Found ${sessionKeys.length} sessions`);
    
    // Process sessions
    for (const sessionKey of sessionKeys) {
      const sessionData = conversation[sessionKey];
      const sessionDate = conversation[`${sessionKey}_date_time`];
      
      if (!sessionData || !Array.isArray(sessionData)) continue;
      
      const speakerA = conversation.speaker_a as string;
      const speakerB = conversation.speaker_b as string;
      
      const content = sessionData.map((turn: any) => {
        const speaker = turn.speaker || (turn.speaker_name === 'a' ? speakerA : speakerB);
        const text = turn.text || turn.content || '';
        return `${speaker}: ${text}`;
      }).join('\n');
      
      await muninn.remember(content, { source: 'locomo', sessionDate });
    }
    
    // Process questions
    const qaList = conv.qa;
    console.log(`❓ Testing ${qaList.length} questions`);
    
    let skippedQuestions = 0;
    
    for (let j = 0; j < qaList.length; j++) {
      const qa = qaList[j];
      const question = qa.question;
      
      // Defensive answer handling (Ernie's Priority 1)
      const expected = (() => {
        if (qa.answer === null || qa.answer === undefined) return '';
        if (Array.isArray(qa.answer)) return qa.answer.join(' ');
        if (typeof qa.answer === 'number') return String(qa.answer);
        return String(qa.answer);
      })();
      
      // Skip questions with no ground truth (Ernie's Priority 2)
      if (!expected) {
        skippedQuestions++;
        continue; // Skip, don't score
      }
      
      const category = qa.category;
      
      // Retrieve observations
      const result = await muninn.recall(question);
      
      // Generate answer
      let answer: string;
      try {
        answer = await generateAnswer(question, result);
      } catch (e) {
        answer = "I don't have information about that.";
        console.log(`   ⚠️ Answer generation failed: ${e}`);
      }
      
      // Score
      const passed = scoreAnswer(answer, expected);
      
      // Ensure category exists
      if (!categoryStats[category]) {
        categoryStats[category] = { correct: 0, total: 0 };
      }
      
      categoryStats[category].total++;
      totalQuestions++;
      
      if (passed) {
        categoryStats[category].correct++;
        totalCorrect++;
        console.log(`✅ [${CATEGORY_NAMES[category]}] "${question.substring(0, 50)}..."`);
      } else {
        console.log(`❌ [${CATEGORY_NAMES[category]}] "${question.substring(0, 50)}..."`);
        console.log(`   Expected: "${expected.substring(0, 80)}"`);
        console.log(`   Got: "${answer.substring(0, 80)}"`);
      }
    }
    
    const convDuration = ((Date.now() - convStart) / 1000 / 60).toFixed(1);
    const runningAccuracy = totalQuestions > 0 ? ((totalCorrect / totalQuestions) * 100).toFixed(1) : '0.0';
    console.log(`\n   Conversation duration: ${convDuration} min`);
    console.log(`   Running accuracy: ${runningAccuracy}% (${totalCorrect}/${totalQuestions})`);
    if (skippedQuestions > 0) {
      console.log(`   Skipped questions (no ground truth): ${skippedQuestions}`);
    }
    
    // Progress save every conversation
    const stats = muninn.getStats();
    console.log(`   DB stats: ${stats.entityCount} entities, ${stats.observationCount} observations`);
  }
  
  const totalDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  // Final results
  console.log('\n=== Final Results ===');
  console.log(`Total Questions: ${totalQuestions}`);
  console.log(`Correct: ${totalCorrect}`);
  const accuracy = totalQuestions > 0 ? ((totalCorrect / totalQuestions) * 100).toFixed(1) : '0.0';
  console.log(`Accuracy: ${accuracy}%`);
  console.log(`Duration: ${totalDuration} minutes`);
  console.log(`Skipped (no ground truth): ${skippedQuestions}\n`);
  
  console.log('By Category:');
  for (let i = 1; i <= 4; i++) {
    const cat = categoryStats[i] || { correct: 0, total: 0 };
    const pct = cat.total > 0 ? ((cat.correct / cat.total) * 100).toFixed(1) : '0.0';
    console.log(`  Category ${i} (${CATEGORY_NAMES[i]}): ${cat.correct}/${cat.total} (${pct}%)`);
  }
  
  console.log('\n=== Comparison to LOCOMO Baselines ===');
  console.log('From ACL 2024 paper:');
  console.log('  GPT-3.5 (conv): 24.5%');
  console.log('  GPT-4 (conv): 42.3%');
  console.log('  Mem0: 66.9%');
  console.log('  Engram: 79.6%');
  console.log(`  Muninn v2.1 (unified): ${((totalCorrect / totalQuestions) * 100).toFixed(1)}%`);
  
  muninn.close();
}

function scoreAnswer(answer: string, expected: string): boolean {
  // Handle undefined/null
  if (!answer || !expected) return false;
  
  const answerLower = answer.toLowerCase().trim();
  const expectedLower = expected.toLowerCase().trim();
  
  // Exact match
  if (answerLower === expectedLower) return true;
  
  // Contains expected
  if (answerLower.includes(expectedLower)) return true;
  
  // Expected contains answer (for partial credit)
  if (expectedLower.includes(answerLower) && answerLower.length > 10) return true;
  
  // Key phrase matching
  const expectedWords = expectedLower.split(/\s+/).filter(w => w.length > 3);
  const answerWords = answerLower.split(/\s+/);
  
  let matchCount = 0;
  for (const word of expectedWords) {
    if (answerWords.some(w => w.includes(word) || word.includes(w))) {
      matchCount++;
    }
  }
  
  // Pass if 50% of expected words are in answer
  return matchCount >= Math.ceil(expectedWords.length * 0.5);
}

runBenchmark().catch(console.error);