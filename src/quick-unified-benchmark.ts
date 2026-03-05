import { Muninn } from './index-unified.js';
import { generateAnswer } from './answer-generation.js';
import { readFileSync, existsSync, unlinkSync } from 'fs';

const dataset = JSON.parse(readFileSync('./benchmark/locomo10.json', 'utf-8'));
const conv = dataset[0]; // Just first conversation

const dbPath = '/tmp/locomo-quick-unified.db';
if (existsSync(dbPath)) unlinkSync(dbPath);
const muninn = new Muninn(dbPath);

const CATEGORY_NAMES: Record<number, string> = {
  1: 'single_hop',
  2: 'temporal',
  3: 'multi_hop',
  4: 'open_domain'
};

async function runQuickBenchmark() {
  console.log('=== Quick Benchmark - Unified Observations ===\n');
  console.log(`Testing: ${conv.sample_id}\n`);
  
  const conversation = conv.conversation;
  const sessionKeys = Object.keys(conversation)
    .filter(k => k.startsWith('session_') && !k.includes('date_time'))
    .sort((a, b) => parseInt(a.replace('session_', '')) - parseInt(b.replace('session_', '')))
    .slice(0, 5); // First 5 sessions only
  
  console.log(`Processing ${sessionKeys.length} sessions (subset)...`);
  
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
  
  const stats = muninn.getStats();
  console.log(`Stats: ${stats.entityCount} entities, ${stats.observationCount} observations\n`);
  
  // Test first 15 questions
  const qaList = conv.qa.slice(0, 15);
  const categoryStats: Record<number, { correct: number; total: number }> = {
    1: { correct: 0, total: 0 },
    2: { correct: 0, total: 0 },
    3: { correct: 0, total: 0 },
    4: { correct: 0, total: 0 }
  };
  
  let totalCorrect = 0;
  
  console.log(`Testing first ${qaList.length} questions:\n`);
  
  for (const qa of qaList) {
    const question = qa.question;
    const expected = Array.isArray(qa.answer) ? qa.answer.join(' ') : String(qa.answer || '');
    const category = qa.category;
    
    const result = await muninn.recall(question);
    let answer: string;
    try {
      answer = await generateAnswer(question, result);
    } catch (e) {
      answer = "I don't have information about that.";
    }
    
    const passed = scoreAnswer(answer, expected);
    
    categoryStats[category].total++;
    
    if (passed) {
      categoryStats[category].correct++;
      totalCorrect++;
      console.log(`✅ [${CATEGORY_NAMES[category]}] "${question.substring(0, 60)}..."`);
    } else {
      console.log(`❌ [${CATEGORY_NAMES[category]}] "${question.substring(0, 60)}..."`);
      console.log(`   Expected: "${expected.substring(0, 80)}"`);
      console.log(`   Got: "${answer.substring(0, 80)}"`);
    }
  }
  
  console.log('\n=== Results ===');
  console.log(`Overall: ${totalCorrect}/${qaList.length} (${((totalCorrect/qaList.length)*100).toFixed(1)}%)`);
  
  for (let i = 1; i <= 4; i++) {
    const cat = categoryStats[i];
    if (cat.total > 0) {
      const pct = ((cat.correct / cat.total) * 100).toFixed(1);
      console.log(`${CATEGORY_NAMES[i]}: ${cat.correct}/${cat.total} (${pct}%)`);
    }
  }
  
  muninn.close();
}

function scoreAnswer(answer: string, expected: string): boolean {
  if (!answer || !expected) return false;
  
  const answerLower = answer.toLowerCase().trim();
  const expectedLower = expected.toLowerCase().trim();
  
  if (answerLower === expectedLower) return true;
  if (answerLower.includes(expectedLower)) return true;
  if (expectedLower.includes(answerLower) && answerLower.length > 10) return true;
  
  const expectedWords = expectedLower.split(/\s+/).filter(w => w.length > 3);
  const answerWords = answerLower.split(/\s+/);
  
  let matchCount = 0;
  for (const word of expectedWords) {
    if (answerWords.some(w => w.includes(word) || word.includes(w))) matchCount++;
  }
  
  return matchCount >= Math.ceil(expectedWords.length * 0.5);
}

runQuickBenchmark().catch(console.error);
