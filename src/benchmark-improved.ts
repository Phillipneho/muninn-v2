// Quick LOCOMO test with temporal improvements
import { Muninn } from './index.js';
import { generateAnswer } from './answer-generation.js';
import { readFileSync, existsSync, unlinkSync } from 'fs';

const dataset = JSON.parse(readFileSync('./benchmark/locomo10.json', 'utf-8'));
const conv = dataset[0];

const dbPath = '/tmp/locomo-improved.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

console.log(`Testing: ${conv.sample_id} (${conv.qa.length} questions)\n`);

// Process all sessions
const conversation = conv.conversation;
const sessionKeys = Object.keys(conversation)
  .filter(k => k.startsWith('session_') && !k.includes('date_time'))
  .sort((a, b) => parseInt(a.replace('session_', '')) - parseInt(b.replace('session_', '')));

console.log(`Processing ${sessionKeys.length} sessions...`);

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
console.log(`Stats: ${stats.entityCount} entities, ${stats.factCount} facts, ${stats.eventCount} events\n`);

// Test first 30 questions
console.log('Testing first 30 questions:\n');

const categoryStats: Record<number, { correct: number; total: number }> = {
  1: { correct: 0, total: 0 },
  2: { correct: 0, total: 0 },
  3: { correct: 0, total: 0 },
  4: { correct: 0, total: 0 }
};

let totalCorrect = 0;
let totalQuestions = 0;

const catNames: Record<number, string> = { 1: 'single_hop', 2: 'temporal', 3: 'multi_hop', 4: 'open_domain' };

for (let i = 0; i < Math.min(30, conv.qa.length); i++) {
  const qa = conv.qa[i];
  if (qa.category === 5) continue;
  
  const result = await muninn.recall(qa.question);
  const answer = await generateAnswer(qa.question, result);
  
  const genNorm = answer.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const expNorm = String(qa.answer).toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  
  const genWords = genNorm.split(' ').filter((w: string) => w.length > 2);
  const expWords = expNorm.split(' ').filter((w: string) => w.length > 2);
  const overlap = genWords.filter((w: string) => expWords.includes(w)).length;
  
  const isCorrect = genNorm === expNorm || 
    genNorm.includes(expNorm) || 
    expNorm.includes(genNorm) ||
    (overlap >= Math.ceil(expWords.length * 0.5));
  
  if (isCorrect) totalCorrect++;
  totalQuestions++;
  categoryStats[qa.category].total++;
  if (isCorrect) categoryStats[qa.category].correct++;
  
  const icon = isCorrect ? '✅' : '❌';
  
  console.log(`${icon} [${catNames[qa.category]}] "${qa.question}"`);
  console.log(`   Expected: "${qa.answer}"`);
  console.log(`   Got: "${answer.substring(0, 100)}${answer.length > 100 ? '...' : ''}"`);
  console.log(`   Source: ${result.source}\n`);
}

console.log('='.repeat(60));
console.log('RESULTS');
console.log('='.repeat(60));
console.log(`\nOverall: ${totalCorrect}/${totalQuestions} (${((totalCorrect/totalQuestions)*100).toFixed(1)}%)\n`);

console.log('By Category:');
for (const [cat, stats] of Object.entries(categoryStats)) {
  const pct = stats.total > 0 ? ((stats.correct/stats.total)*100).toFixed(1) : '0.0';
  console.log(`  ${catNames[parseInt(cat)]}: ${stats.correct}/${stats.total} (${pct}%)`);
}

muninn.close();