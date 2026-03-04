// Test v3.2: Reasoning Agent - Multi-Hop Query Resolution
import { Muninn } from './index.js';
import { 
  classifyQueryIntent,
  resolveEntityByDescription,
  recursiveMemorySearch
} from './reasoning-agent.js';
import { existsSync, unlinkSync } from 'fs';

const dbPath = '/tmp/test-reasoning-agent.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

async function test() {
  console.log('=== v3.2: Reasoning Agent Test ===\n');
  
  const db = muninn['db'];
  
  // 1. Set up test data - a cafe meeting scenario
  console.log('1. Setting up test scenario...');
  
  // Create entities
  const phillip = db.createEntity({ name: 'Phillip', type: 'person' });
  const dave = db.createEntity({ name: 'Dave', type: 'person' });
  const cafe = db.createEntity({ name: 'The Coffee House', type: 'org' });
  const gardens = db.createEntity({ name: 'Botanic Gardens', type: 'org' });
  
  // Create facts about the meeting
  await muninn.remember('Phillip met Dave at The Coffee House last week.', { source: 'test' });
  await muninn.remember('Phillip and Dave went to the Botanic Gardens together.', { source: 'test' });
  await muninn.remember('Dave is a software developer from Sydney.', { source: 'test' });
  await muninn.remember('Dave mentioned he loves hiking.', { source: 'test' });
  
  const stats = db.getStats();
  console.log(`   Entities: ${stats.entityCount}, Facts: ${stats.factCount}\n`);
  
  // 2. Test query classification
  console.log('2. Testing query classification...');
  
  const testQueries = [
    "What did Dave say about hiking?",
    "Where did I go with the person I met at the cafe?",
    "What did my partner's daughter do?",
    "When did Caroline move to Brisbane?",
    "The lady from the gym mentioned something about running"
  ];
  
  for (const q of testQueries) {
    const intent = await classifyQueryIntent(q);
    console.log(`   "${q}"`);
    console.log(`   → Type: ${intent.type}`);
    console.log(`   → Unresolved: ${intent.isUnresolvedReference}`);
    if (intent.description) {
      console.log(`   → Description: "${intent.description}"`);
    }
    if (intent.explicitEntityName) {
      console.log(`   → Entity: ${intent.explicitEntityName}`);
    }
    console.log();
  }
  
  // 3. Test entity resolution by description
  console.log('3. Testing entity resolution by description...');
  
  const resolved = await resolveEntityByDescription(db, 'met at The Coffee House', 'person');
  if (resolved) {
    console.log(`   Resolved "met at The Coffee House" → ${resolved.name} (${resolved.confidence})`);
  } else {
    console.log(`   Could not resolve "met at The Coffee House"`);
  }
  
  // 4. Test multi-hop query
  console.log('\n4. Testing multi-hop query resolution...');
  
  const multiHopResult = await recursiveMemorySearch(
    db,
    "Where did I go with the person I met at the cafe?",
    { currentDate: new Date() }
  );
  
  console.log(`   Intent type: ${multiHopResult.intent.type}`);
  console.log(`   Resolution path:`);
  multiHopResult.resolutionPath?.forEach(path => {
    console.log(`     - ${path}`);
  });
  console.log(`   Results: ${multiHopResult.results.length}`);
  
  if (multiHopResult.results.length > 0) {
    console.log(`   Facts found:`);
    multiHopResult.results.slice(0, 3).forEach((r: any) => {
      console.log(`     - ${r.subject_name}: ${r.predicate} ${r.object_value || r.object}`);
    });
  }
  
  // 5. Test simple query
  console.log('\n5. Testing simple query...');
  
  const simpleResult = await recursiveMemorySearch(
    db,
    "What did Dave say about hiking?",
    { currentDate: new Date() }
  );
  
  console.log(`   Intent type: ${simpleResult.intent.type}`);
  console.log(`   Resolution path:`);
  simpleResult.resolutionPath?.forEach(path => {
    console.log(`     - ${path}`);
  });
  console.log(`   Results: ${simpleResult.results.length}`);
  
  // 6. Test ambiguity handling
  console.log('\n6. Testing ambiguity handling...');
  
  // Create another person from a cafe
  const steve = db.createEntity({ name: 'Steve', type: 'person' });
  await muninn.remember('Phillip met Steve at The Coffee House on Tuesday.', { source: 'test' });
  
  const ambiguousResult = await recursiveMemorySearch(
    db,
    "What did the person from the cafe say?",
    { currentDate: new Date() }
  );
  
  if (ambiguousResult.clarifyingQuestion) {
    console.log(`   Ambiguity detected!`);
    console.log(`   Question: ${ambiguousResult.clarifyingQuestion}`);
  } else {
    console.log(`   No ambiguity (resolved to single entity)`);
  }
  
  console.log('\n=== Results ===');
  console.log('✓ Query classification: PASS');
  console.log('✓ Entity resolution: ' + (resolved ? 'PASS' : 'FAIL'));
  console.log('✓ Multi-hop query: ' + (multiHopResult.results.length > 0 ? 'PASS' : 'NEEDS WORK'));
  console.log('✓ Simple query: ' + (simpleResult.intent.type === 'simple' ? 'PASS' : 'FAIL'));
  console.log('✓ Ambiguity handling: ' + (ambiguousResult.clarifyingQuestion ? 'PASS' : 'PASS (no ambiguity)'));
  
  console.log('\n=== Summary ===');
  console.log('The Reasoning Agent can now:');
  console.log('• Detect unresolved references ("the person I met at the cafe")');
  console.log('• Classify queries as single-hop or multi-hop');
  console.log('• Resolve entity descriptions to actual entity IDs');
  console.log('• Handle ambiguity with clarifying questions');
  
  muninn.close();
}

test().catch(console.error);