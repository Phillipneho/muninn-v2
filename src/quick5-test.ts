// Quick LOCOMO test - first 5 questions
import { Muninn } from './index.js';
import { generateAnswer } from './answer-generation.js';
import { readFileSync, existsSync, unlinkSync } from 'fs';

const dataset = JSON.parse(readFileSync('./benchmark/locomo10.json', 'utf-8'));
const conv = dataset[0];

const dbPath = '/tmp/locomo-quick5.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

console.log(`Testing: ${conv.sample_id}\n`);

// Process first 3 sessions only
const conversation = conv.conversation;
const sessionKeys = Object.keys(conversation)
  .filter(k => k.startsWith('session_') && !k.includes('date_time'))
  .sort((a, b) => parseInt(a.replace('session_', '')) - parseInt(b.replace('session_', '')))
  .slice(0, 3);

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
console.log(`Stats: ${stats.entityCount} entities, ${stats.factCount} facts\n`);

// Test first 10 questions
console.log('Testing first 10 questions:\n');

let correct = 0;
let total = 0;

for (let i = 0; i < 10 && i < conv.qa.length; i++) {
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
  
  if (isCorrect) correct++;
  total++;
  
  const icon = isCorrect ? '✅' : '❌';
  const catName = ['', 'single_hop', 'temporal', 'multi_hop', 'open_domain'][qa.category];
  
  console.log(`${icon} [${catName}] "${qa.question}"`);
  console.log(`   Expected: "${qa.answer}"`);
  console.log(`   Got: "${answer}"`);
  console.log(`   Source: ${result.source}\n`);
}

console.log(`\nResults: ${correct}/${total} (${((correct/total)*100).toFixed(1)}%)\n`);

muninn.close();