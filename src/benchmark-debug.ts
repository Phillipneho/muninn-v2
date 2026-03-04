/**
 * LOCOMO Benchmark Debug Runner
 * Tests extraction and retrieval on first conversation only
 */

import { Muninn } from './index.js';
import { generateAnswer } from './answer-generation.js';
import { readFileSync, existsSync, unlinkSync } from 'fs';

const datasetPath = './benchmark/locomo10.json';
const dataset = JSON.parse(readFileSync(datasetPath, 'utf-8'));

const dbPath = '/tmp/locomo-debug.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

// Just test first conversation
const conv = dataset[0];
console.log(`\n📍 Testing conversation: ${conv.sample_id}`);
console.log(`   ${conv.qa.length} questions\n`);

// Process just first 3 sessions
const conversation = conv.conversation;
const sessionKeys = Object.keys(conversation)
  .filter(k => k.startsWith('session_') && !k.includes('date_time'))
  .sort((a, b) => {
    const numA = parseInt(a.replace('session_', ''));
    const numB = parseInt(b.replace('session_', ''));
    return numA - numB;
  })
  .slice(0, 3);

console.log(`📚 Processing ${sessionKeys.length} sessions...\n`);

for (const sessionKey of sessionKeys) {
  const sessionData = conversation[sessionKey];
  const sessionDate = conversation[`${sessionKey}_date_time`];
  
  if (!sessionData || !Array.isArray(sessionData)) continue;
  
  console.log(`  📖 ${sessionKey} (${sessionDate || 'no date'}) - ${sessionData.length} turns`);
  
  // Build session content
  const speakerA = conversation.speaker_a as string;
  const speakerB = conversation.speaker_b as string;
  
  const sessionContent = sessionData.slice(0, 5).map((turn: any) => {
    const speaker = turn.speaker || (turn.speaker_name === 'a' ? speakerA : speakerB);
    const text = turn.text || turn.content || '';
    return `${speaker}: ${text}`;
  }).join('\n');
  
  console.log(`     Content sample: ${sessionContent.substring(0, 200)}...\n`);
  
  // Remember
  try {
    const result = await muninn.remember(sessionContent, {
      source: `test-${conv.sample_id}`,
      sessionDate: sessionDate
    });
    
    console.log(`     Result:`);
    console.log(`       Entities: ${result.entitiesCreated}`);
    console.log(`       Facts: ${result.factsCreated}`);
    console.log(`       Events: ${result.eventsCreated}`);
    console.log(`       Contradictions: ${result.contradictions}\n`);
  } catch (e: any) {
    console.error(`     ❌ Error:`, e.message);
  }
}

// Now query
console.log('\n❓ Testing retrieval...\n');

const testQueries = [
  'Who is Caroline?',
  'What does Caroline do?',
  'When did Caroline go to the LGBTQ support group?',
  'What is Caroline\'s identity?'
];

for (const query of testQueries) {
  console.log(`Query: "${query}"`);
  
  try {
    const result = await muninn.recall(query);
    console.log(`  Source: ${result.source}`);
    
    if (result.facts && result.facts.length > 0) {
      console.log(`  Facts:`);
      result.facts.forEach(f => {
        console.log(`    - ${f.predicate}: ${f.objectValue || f.objectEntityId}`);
      });
    }
    
    if (result.events && result.events.length > 0) {
      console.log(`  Events:`);
      result.events.forEach(e => {
        console.log(`    - ${e.attribute}: ${e.oldValue} → ${e.newValue}`);
      });
    }
    
    if (result.path && result.path.length > 0) {
      console.log(`  Path:`);
      result.path.forEach(p => {
        console.log(`    - ${p.entity} → ${p.relationship} → ${p.relatedEntity}`);
      });
    }
    
    // Generate answer
    const answer = await generateAnswer(query, result);
    console.log(`  Generated Answer: ${answer}`);
    
    console.log('');
  } catch (e: any) {
    console.error(`  ❌ Error:`, e.message);
  }
}

// Check what's stored
console.log('\n📊 Checking stored data...\n');

const db = muninn['db'];
const stats = db.getStats();
console.log(`Stats:`, stats);

// Get some entities
const entities = db['db'].prepare('SELECT name, type FROM entities LIMIT 10').all();
console.log(`\nEntities (first 10):`);
entities.forEach((e: any) => console.log(`  - ${e.name} (${e.type})`));

// Get some facts
const facts = db['db'].prepare(`
  SELECT e.name as subject, f.predicate, f.object_value as object, f.confidence
  FROM facts f
  JOIN entities e ON f.subject_entity_id = e.id
  LIMIT 10
`).all();
console.log(`\nFacts (first 10):`);
facts.forEach((f: any) => console.log(`  - ${f.subject} → ${f.predicate} → ${f.object} (conf: ${f.confidence})`));

// Test direct fact query
console.log(`\n📋 Testing direct fact query for "Caroline":`);
const carolineFacts = db.getCurrentFacts('Caroline');
console.log(`Found ${carolineFacts.length} facts for Caroline:`);
carolineFacts.forEach((f: any) => console.log(`  - ${f.predicate}: ${f.object_value || f.object}`));

// Test entity extraction from query
console.log(`\n🔍 Testing entity extraction from queries:`);
for (const q of testQueries) {
  // Simple extraction (same as retrieval-sqlite.ts)
  const capitalized = q.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
  const quoted = q.match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, '')) || [];
  const simple = [...new Set([...capitalized, ...quoted])];
  console.log(`  "${q}" → simple: ${JSON.stringify(simple)}`);
}

// Test direct database query
console.log(`\n📋 Testing direct getCurrentFacts for "Caroline":`);
const factsForCaroline = db.getCurrentFacts('Caroline');
console.log(`Found ${factsForCaroline.length} facts for Caroline:`);
factsForCaroline.forEach((f: any) => console.log(`  - ${f.predicate}: ${f.object_value || f.object}`));

muninn.close();
console.log('\n✓ Debug complete');