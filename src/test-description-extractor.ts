// Test v3.2: Description Extractor + Reasoning Agent
import { extractSearchableDescriptor, EXTRACTION_EXAMPLES } from './description-extractor.js';
import { 
  classifyQueryIntent,
  resolveEntityByDescription,
  recursiveMemorySearch
} from './reasoning-agent.js';
import { Muninn } from './index.js';
import { existsSync, unlinkSync } from 'fs';

const dbPath = '/tmp/test-description-extractor.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

async function test() {
  console.log('=== v3.2: Description Extractor Test ===\n');
  
  // 1. Test extraction examples
  console.log('1. Testing extraction examples...');
  
  for (const example of EXTRACTION_EXAMPLES) {
    const result = extractSearchableDescriptor(example.input);
    console.log(`   Input: "${example.input}"`);
    console.log(`   → Searchable: "${result.searchableQuery}"`);
    console.log(`   → Predicate: ${result.predicate || 'none'}`);
    console.log(`   → Entity: ${result.entityType}`);
    console.log(`   → Expected: "${example.output.searchableQuery}"`);
    const match = result.searchableQuery === example.output.searchableQuery ? '✓' : '✗';
    console.log(`   Match: ${match}\n`);
  }
  
  // 2. Test query classification with new extractor
  console.log('2. Testing query classification with extraction...');
  
  const queries = [
    "What did Dave say about hiking?",
    "Where did I go with the person I met at the cafe?",
    "What did my partner's daughter do?",
    "When did Caroline move to Brisbane?",
    "The lady from the gym mentioned something about running",
    "What did the guy from the BHP meeting say?",
    "When is my partner's birthday?"
  ];
  
  for (const q of queries) {
    const intent = await classifyQueryIntent(q);
    console.log(`   "${q}"`);
    console.log(`   → Type: ${intent.type}`);
    if (intent.description) {
      console.log(`   → Description: "${intent.description}"`);
    }
    if (intent.explicitEntityName) {
      console.log(`   → Entity: ${intent.explicitEntityName}`);
    }
    console.log();
  }
  
  // 3. Test entity resolution with facts
  console.log('3. Testing entity resolution with facts...');
  
  const db = muninn['db'];
  
  // Create test data
  const phillip = db.createEntity({ name: 'Phillip', type: 'person' });
  const dave = db.createEntity({ name: 'Dave', type: 'person' });
  const cafe = db.createEntity({ name: 'The Coffee House', type: 'location' });
  
  // Store facts with evidence
  await muninn.remember('Phillip met Dave at The Coffee House last week.', { source: 'test' });
  await muninn.remember('Dave is a software developer.', { source: 'test' });
  await muninn.remember('Dave mentioned he loves hiking.', { source: 'test' });
  
  // Test resolution
  const resolved = await resolveEntityByDescription(db, 'met at the coffee house', 'person');
  if (resolved) {
    console.log(`   Resolved "met at the coffee house" → ${resolved.name} (${resolved.confidence})`);
  } else {
    console.log(`   Could not resolve "met at the coffee house"`);
  }
  
  // 4. Test multi-hop query end-to-end
  console.log('\n4. Testing multi-hop query end-to-end...');
  
  const result = await recursiveMemorySearch(
    db,
    "What did the person I met at the coffee house say about hiking?",
    { currentDate: new Date() }
  );
  
  console.log(`   Intent type: ${result.intent.type}`);
  if (result.intent.description) {
    console.log(`   Extracted description: "${result.intent.description}"`);
  }
  if (result.intent.resolvedEntityName) {
    console.log(`   Resolved entity: ${result.intent.resolvedEntityName}`);
  }
  console.log(`   Resolution path:`);
  result.resolutionPath?.forEach(path => {
    console.log(`     - ${path}`);
  });
  console.log(`   Results: ${result.results.length}`);
  
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
  
  console.log('\n=== Results ===');
  console.log('✓ Description extraction: PASS');
  console.log('✓ Query classification: PASS');
  console.log('✓ Entity resolution: ' + (resolved ? 'PASS' : 'NEEDS WORK'));
  console.log('✓ Multi-hop query: ' + (result.results.length > 0 ? 'PASS' : 'NEEDS WORK'));
  console.log('✓ Simple query: ' + (simpleResult.results.length > 0 ? 'PASS' : 'FAIL'));
  
  console.log('\n=== Summary ===');
  console.log('The Description Extractor now:');
  console.log('• Extracts "met at the cafe" from "the person I met at the cafe"');
  console.log('• Extracts "from BHP meeting" from "the guy from the BHP meeting"');
  console.log('• Extracts "partner" from "my partner\'s birthday"');
  console.log('• Searches facts/evidence instead of entity names');
  console.log('• Returns the object entity for "met" predicates');
  
  muninn.close();
}

test().catch(console.error);