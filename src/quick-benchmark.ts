// Quick LOCOMO test - just first conversation
import { Muninn } from './index.js';
import { generateAnswer } from './answer-generation.js';
import { readFileSync, existsSync, unlinkSync } from 'fs';

const datasetPath = './benchmark/locomo10.json';
const dataset = JSON.parse(readFileSync(datasetPath, 'utf-8'));

const dbPath = '/tmp/locomo-quick-test.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

// Just first conversation
const conv = dataset[0];
console.log(`\n📍 Testing: ${conv.sample_id} (${conv.qa.length} questions)\n`);

// Process all sessions
const conversation = conv.conversation;
const sessionKeys = Object.keys(conversation)
  .filter(k => k.startsWith('session_') && !k.includes('date_time'))
  .sort((a, b) => parseInt(a.replace('session_', '')) - parseInt(b.replace('session_', '')));

console.log(`📚 Processing ${sessionKeys.length} sessions...`);

for (const sessionKey of sessionKeys) {
  const sessionData = conversation[sessionKey];
  const sessionDate = conversation[`${sessionKey}_date_time`];
  
  if (!sessionData || !Array.isArray(sessionData)) continue;
  
  const speakerA = conversation.speaker_a as string;
  const speakerB = conversation.speaker_b as string;
  
  const sessionContent = sessionData.map((turn: any) => {
    const speaker = turn.speaker || (turn.speaker_name === 'a' ? speakerA : speakerB);
    const text = turn.text || turn.content || '';
    return `${speaker}: ${text}`;
  }).join('\n');
  
  await muninn.remember(sessionContent, {
    source: `conversation-${conv.sample_id}`,
    sessionDate: sessionDate
  });
  
  process.stdout.write('.');
}
console.log(' done!\n');

// Get stats
const db = muninn['db'];
const stats = db.getStats();
console.log(`📊 Stats: ${stats.entityCount} entities, ${stats.factCount} facts, ${stats.eventCount} events\n`);

// Answer questions
let correct = 0;
let total = 0;
const categoryStats: Record<number, { correct: number; total: number }> = { 1: { correct: 0, total: 0 }, 2: { correct: 0, total: 0 }, 3: { correct: 0, total: 0 }, 4: { correct: 0, total: 0 } };

console.log(`❓ Answering questions...\n`);

for (const qa of conv.qa) {
  if (qa.category === 5) continue;
  
  const result = await muninn.recall(qa.question);
  const answer = await generateAnswer(qa.question, result);
  
  // Check correctness
  const genNorm = answer.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const expNorm = qa.answer.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  
  const isCorrect = genNorm.includes(expNorm) || expNorm.includes(genNorm) || 
    genNorm.split(' ').filter((w: string) => w.length > 2).some((w: string) => expNorm.includes(w) && expNorm.split(' ').filter((x: string) => x.length > 2).includes(w));
  
  if (isCorrect) correct++;
  total++;
  categoryStats[qa.category].total++;
  if (isCorrect) categoryStats[qa.category].correct++;
  
  const icon = isCorrect ? '✅' : '❌';
  const catName = ['', 'single_hop', 'temporal', 'multi_hop', 'open_domain'][qa.category];
  
  if (!isCorrect) {
    console.log(`${icon} [${catName}] "${qa.question}"`);
    console.log(`   Expected: "${qa.answer}"`);
    console.log(`   Got: "${answer}"`);
    console.log(`   Source: ${result.source}\n`);
  }
}

// Print results
console.log('\n' + '='.repeat(80));
console.log('📊 RESULTS');
console.log('='.repeat(80));
console.log(`\nOverall: ${correct}/${total} (${((correct/total)*100).toFixed(1)}%)\n`);

console.log('By Category:');
for (const [cat, stats] of Object.entries(categoryStats)) {
  const pct = stats.total > 0 ? ((stats.correct/stats.total)*100).toFixed(1) : '0.0';
  const name = ['', 'single_hop', 'temporal', 'multi_hop', 'open_domain'][parseInt(cat)];
  console.log(`  ${name}: ${stats.correct}/${stats.total} (${pct}%)`);
}

muninn.close();