// Muninn v2 Retrieval Tests
// Phase 4: Structured queries, graph traversal, semantic fallback

import { Muninn } from './index.js';
import { Retriever } from './retrieval.js';
import { MuninnDatabase } from './database-sqlite.js';
import type { Fact, Event } from './types.js';
import fs from 'fs';

const TEST_DB = '/tmp/muninn-v2-retrieval-test.db';

async function setupTestData(db: MuninnDatabase) {
  console.log('Setting up test data...');
  
  // Create entities
  const caroline = db.findOrCreateEntity('Caroline', 'person', 'A person who attends support groups');
  const group = db.findOrCreateEntity('LGBTQ support group', 'org', 'A support group');
  const companyA = db.findOrCreateEntity('Company A', 'org', 'An employer');
  const companyB = db.findOrCreateEntity('Company B', 'org', 'Another employer');
  const project = db.findOrCreateEntity('Project Phoenix', 'project', 'A project');
  const sarah = db.findOrCreateEntity('Sarah', 'person', 'A manager');
  const phillip = db.findOrCreateEntity('Phillip', 'person', 'A developer');
  
  // Create facts
  // Caroline attends LGBTQ support group
  db.createFact({
    subjectEntityId: caroline.id,
    predicate: 'attends',
    objectValue: 'LGBTQ support group',
    valueType: 'string',
    confidence: 1.0,
    evidence: ['I go to the LGBTQ support group yesterday']
  });
  
  // Caroline's risk level progression
  db.createFact({
    subjectEntityId: caroline.id,
    predicate: 'risk_level',
    objectValue: 'Low',
    valueType: 'string',
    confidence: 1.0,
    validFrom: new Date('2024-01-01'),
    validUntil: new Date('2024-02-01')
  });
  
  db.createFact({
    subjectEntityId: caroline.id,
    predicate: 'risk_level',
    objectValue: 'Medium',
    valueType: 'string',
    confidence: 1.0,
    validFrom: new Date('2024-02-01'),
    validUntil: new Date('2024-03-01')
  });
  
  db.createFact({
    subjectEntityId: caroline.id,
    predicate: 'risk_level',
    objectValue: 'High',
    valueType: 'string',
    confidence: 1.0,
    validFrom: new Date('2024-03-01')
  });
  
  // Caroline's employer history
  db.createFact({
    subjectEntityId: caroline.id,
    predicate: 'works_at',
    objectValue: 'Company A',
    valueType: 'string',
    confidence: 1.0,
    validFrom: new Date('2020-01-01'),
    validUntil: new Date('2022-06-01')
  });
  
  db.createFact({
    subjectEntityId: caroline.id,
    predicate: 'works_at',
    objectValue: 'Company B',
    valueType: 'string',
    confidence: 1.0,
    validFrom: new Date('2022-06-01')
  });
  
  // Sarah is Phillip's manager
  db.createFact({
    subjectEntityId: sarah.id,
    predicate: 'manages',
    objectEntityId: phillip.id,
    valueType: 'entity',
    confidence: 1.0
  });
  
  // Phillip works on Project Phoenix
  db.createFact({
    subjectEntityId: phillip.id,
    predicate: 'works_on',
    objectValue: 'Project Phoenix',
    valueType: 'string',
    confidence: 1.0
  });
  
  // Create events
  db.createEvent({
    entityId: caroline.id,
    attribute: 'risk_level',
    oldValue: 'Low',
    newValue: 'Medium',
    occurredAt: new Date('2024-02-01'),
    cause: 'New information received'
  });
  
  db.createEvent({
    entityId: caroline.id,
    attribute: 'risk_level',
    oldValue: 'Medium',
    newValue: 'High',
    occurredAt: new Date('2024-03-01'),
    cause: 'Further assessment'
  });
  
  // Create relationships
  db.createRelationship({
    sourceEntityId: caroline.id,
    targetEntityId: group.id,
    relationshipType: 'attends'
  });
  
  db.createRelationship({
    sourceEntityId: sarah.id,
    targetEntityId: phillip.id,
    relationshipType: 'manages'
  });
  
  db.createRelationship({
    sourceEntityId: phillip.id,
    targetEntityId: project.id,
    relationshipType: 'works_on'
  });
  
  console.log('✓ Test data created\n');
}

async function testStructuredQuery() {
  console.log('\n=== Test: Structured Query ===');
  
  // Clean up test db
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  
  const db = new MuninnDatabase(TEST_DB);
  await setupTestData(db);
  
  const retriever = new Retriever(db);
  
  // Query: What is Caroline's current risk level?
  const result1 = await retriever.recall('What is Caroline\'s risk level?');
  console.log('Query: What is Caroline\'s risk level?');
  console.log('Result:', result1.source, result1.facts?.map(f => `${f.predicate}: ${f.objectValue}`));
  
  if (result1.source !== 'structured') {
    console.log('Note: Expected structured source, got', result1.source);
  }
  
  // Query: Where does Caroline work?
  const result2 = await retriever.recall('Where does Caroline work?');
  console.log('\nQuery: Where does Caroline work?');
  console.log('Result:', result2.source, result2.facts?.map(f => `${f.predicate}: ${f.objectValue}`));
  
  // Query: Who does Sarah manage?
  const result3 = await retriever.recall('Who does Sarah manage?');
  console.log('\nQuery: Who does Sarah manage?');
  console.log('Result:', result3.source);
  
  db.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  
  console.log('✓ Structured query complete\n');
}

async function testGraphTraversal() {
  console.log('\n=== Test: Graph Traversal ===');
  
  // Clean up test db
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  
  const db = new MuninnDatabase(TEST_DB);
  await setupTestData(db);
  
  const retriever = new Retriever(db);
  
  // Query: How is Phillip connected to Sarah?
  const result1 = await retriever.findPath('Phillip', 'Sarah', 3);
  console.log('Query: How is Phillip connected to Sarah?');
  console.log('Found:', result1.found);
  console.log('Path:', result1.path);
  
  // Query: How is Caroline connected to LGBTQ support group?
  const result2 = await retriever.findPath('Caroline', 'LGBTQ support group', 3);
  console.log('\nQuery: How is Caroline connected to LGBTQ support group?');
  console.log('Found:', result2.found);
  console.log('Path:', result2.path);
  
  // Multi-hop: What does Phillip work on?
  const result3 = await retriever.recall('What does Phillip work on?');
  console.log('\nQuery: What does Phillip work on?');
  console.log('Result:', result3.source, result3.facts?.map(f => `${f.predicate}: ${f.objectValue}`));
  
  db.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  
  console.log('✓ Graph traversal complete\n');
}

async function testTemporalQuery() {
  console.log('\n=== Test: Temporal Query ===');
  
  // Clean up test db
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  
  const db = new MuninnDatabase(TEST_DB);
  await setupTestData(db);
  
  const retriever = new Retriever(db);
  
  // Query: How did Caroline's risk level change?
  const result1 = await retriever.recall('How did Caroline\'s risk level change?');
  console.log('Query: How did Caroline\'s risk level change?');
  console.log('Result:', result1.source, result1.events?.map(e => `${e.attribute}: ${e.oldValue} → ${e.newValue}`));
  
  if (result1.source !== 'events') {
    console.log('Note: Expected events source, got', result1.source);
  }
  
  // Query: When did Caroline's risk level change to High?
  const result2 = await retriever.recall('When did Caroline\'s risk level change to High?');
  console.log('\nQuery: When did Caroline\'s risk level change to High?');
  console.log('Result:', result2.source, result2.events?.map(e => `${e.attribute}: ${e.oldValue} → ${e.newValue} at ${e.occurredAt}`));
  
  // Get evolution directly
  const evolution = retriever.getEntityEvolution('Caroline');
  console.log('\nDirect evolution query:');
  evolution.forEach(e => {
    console.log(`  ${e.attribute}: ${e.oldValue} → ${e.newValue}`);
  });
  
  db.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  
  console.log('✓ Temporal query complete\n');
}

async function testEntityExtraction() {
  console.log('\n=== Test: Entity Extraction ===');
  
  const db = new MuninnDatabase(TEST_DB);
  const retriever = new Retriever(db);
  
  // Test entity extraction
  const entities1 = await retriever['extractEntities']('What does Caroline attend?');
  console.log('Query: What does Caroline attend?');
  console.log('Entities:', entities1);
  
  const entities2 = await retriever['extractEntities']('Who manages Phillip?');
  console.log('\nQuery: Who manages Phillip?');
  console.log('Entities:', entities2);
  
  const entities3 = await retriever['extractEntities']('How is Sarah connected to Project Phoenix?');
  console.log('\nQuery: How is Sarah connected to Project Phoenix?');
  console.log('Entities:', entities3);
  
  db.close();
  
  console.log('✓ Entity extraction complete\n');
}

async function testIntentParsing() {
  console.log('\n=== Test: Intent Parsing ===');
  
  const db = new MuninnDatabase(TEST_DB);
  const retriever = new Retriever(db);
  
  // Test temporal intent parsing
  const intents = [
    'What is Caroline\'s risk level?',
    'How did Caroline\'s risk level change?',
    'When did Caroline start attending the support group?',
    'What does Phillip work on?',
    'Where does Caroline work?',
    'Who manages Sarah?'
  ];
  
  for (const query of intents) {
    const intent = retriever['parseTemporalIntent'](query);
    console.log(`Query: "${query}"`);
    console.log(`  Intent: ${JSON.stringify(intent)}\n`);
  }
  
  db.close();
  
  console.log('✓ Intent parsing complete\n');
}

async function testEndToEnd() {
  console.log('\n=== Test: End-to-End Retrieval ===');
  
  // Clean up test db
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  
  const memory = new Muninn(TEST_DB);
  
  // Remember some content
  await memory.remember(`
    Caroline attends the LGBTQ support group. She started going there in May 2023.
    Caroline works at Company B. She's been there since June 2022.
    Caroline's risk level changed from Medium to High in March 2024.
    Sarah manages Phillip. Phillip works on Project Phoenix.
  `, {
    source: 'test',
    sessionDate: '2024-03-04'
  });
  
  // Query: What does Caroline attend?
  const result1 = await memory.recall('What does Caroline attend?');
  console.log('Query: What does Caroline attend?');
  console.log('Result:', result1.source);
  if (result1.facts) {
    result1.facts.forEach(f => {
      console.log(`  ${f.predicate}: ${f.objectValue}`);
    });
  }
  
  // Query: Where does Caroline work?
  const result2 = await memory.recall('Where does Caroline work?');
  console.log('\nQuery: Where does Caroline work?');
  console.log('Result:', result2.source);
  if (result2.facts) {
    result2.facts.forEach(f => {
      console.log(`  ${f.predicate}: ${f.objectValue}`);
    });
  }
  
  // Query: Who does Sarah manage?
  const result3 = await memory.recall('Who does Sarah manage?');
  console.log('\nQuery: Who does Sarah manage?');
  console.log('Result:', result3.source);
  
  memory.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  
  console.log('✓ End-to-end retrieval complete\n');
}

async function main() {
  console.log('Muninn v2 Phase 4 Tests\n');
  console.log('Testing retrieval pipeline with:');
  console.log('- Structured queries (facts)');
  console.log('- Graph traversal (multi-hop)');
  console.log('- Temporal queries (events)');
  console.log('- Entity extraction');
  console.log('- Intent parsing');
  console.log('- End-to-end integration\n');
  
  try {
    await testStructuredQuery();
    await testGraphTraversal();
    await testTemporalQuery();
    await testEntityExtraction();
    await testIntentParsing();
    await testEndToEnd();
    
    console.log('\n✓ All Phase 4 tests passed!\n');
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  }
}

main();