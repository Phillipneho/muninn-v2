// Quick subset test - 5 sessions, 15 questions
import { Muninn } from './index.js';
import { generateAnswer } from './answer-generation.js';
import { readFileSync, existsSync, unlinkSync } from 'fs';

const dataset = JSON.parse(readFileSync('./benchmark/locomo10.json', 'utf-8'));
const conv = dataset[0];

const dbPath = '/tmp/locomo-subset.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

console.log(`Testing: ${conv.sample_id}\n`);

// Process first 5 sessions only
const conversation = conv.conversation;
const sessionKeys = Object.keys(conversation)
  .filter(k => k.startsWith('session_') && !k.includes('date_time'))
  .sort((a, b) => parseInt(a.replace('session_', '')) - parseInt(b.replace('session_', '')))
  .slice(0, 5);

console.log(`Processing ${sessionKeys.length} sessions (subset)...`);

for (const sessionKey of sessionKeys) {
  const sessionData = conversation[sessionKey];
  const sessionDate = conversation[`${sessionKey}_date_time`];
  
  if (!sessionData || !Array.isArray(sessionData)) continue;
  
  const speakerA = conversation.speaker_a;
  const speakerB = conversation.speaker_b;
  
  const content = sessionData.map((turn: any) => {
    const speaker = turn.speaker || (turn.speaker_name === 'a' ? speakerA : speakerB);
    const text = turn.text || turn.content || '';
    return `${speaker}: ${text}`;
  }).join('\n');
  
  await muninn.remember(content, { source: 'test', sessionDate });
}

const stats = muninn['db'].getStats();
console.log(`Stats: ${stats.entityCount} entities, ${stats.factCount} facts\n`);

// Test 15 questions
const catNames: Record<number, string> = { 1: 'single_hop', 2: 'temporal', 3: 'multi_hop', 4: 'open_domain' };
const categoryStats: Record<number, { correct: number; total: number }> = { 1: { correct: 0, total: 0 }, 2: { correct: 0, total: 0 }, 3: { correct: 0, total: 0 }, 4: { correct: 0, total: 0 } };
let totalCorrect = 0, totalQuestions = 0;

console.log('Testing first 15 questions:\n');

for (let i = 0; i < 15 && i < conv.qa.length; i++) {
  const qa = conv.qa[i];
  if (qa.category === 5) continue;
  
  const result = await muninn.recall(qa.question);
  const answer = await generateAnswer(qa.question, result);
  
  const genNorm = answer.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const expNorm = String(qa.answer).toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const genWords = genNorm.split(' ').filter((w: string) => w.length > 2);
  const expWords = expNorm.split(' ').filter((w: string) => w.length > 2);
  const overlap = genWords.filter((w: string) => expWords.includes(w)).length;
  
  const isCorrect = genNorm === expNorm || genNorm.includes(expNorm) || expNorm.includes(genNorm) || (overlap >= Math.ceil(expWords.length * 0.5));
  
  if (isCorrect) totalCorrect++;
  totalQuestions++;
  categoryStats[qa.category].total++;
  if (isCorrect) categoryStats[qa.category].correct++;
  
  console.log(`${isCorrect ? '✅' : '❌'} [${catNames[qa.category]}] "${qa.question}"`);
  console.log(`   Expected: "${qa.answer}"`);
  console.log(`   Got: "${answer.substring(0,80)}${answer.length > 80 ? '...' : ''}"\n`);
}

console.log('='.repeat(50));
console.log(`Results: ${totalCorrect}/${totalQuestions} (${((totalCorrect/totalQuestions)*100).toFixed(1)}%)\n`);

for (const [cat, stats] of Object.entries(categoryStats)) {
  if (stats.total > 0) {
    console.log(`${catNames[parseInt(cat)]}: ${stats.correct}/${stats.total}`);
  }
}

muninn.close();