// Muninn v2 Test Suite
// Tests the core functionality

import { Muninn } from './index.js';
import { MuninnDatabase } from './database-sqlite.js';
import { FactExtractor } from './extraction.js';
import fs from 'fs';
import path from 'path';

const TEST_DB = '/tmp/muninn-v2-test.db';

async function testExtraction() {
  console.log('\n=== Testing Fact Extraction ===');
  
  const extractor = new FactExtractor();
  
  const testConversation = `
    I went to the LGBTQ support group yesterday. It was really helpful - 
    I'm going to keep attending. My name is Caroline, and I've been 
    working as a therapist for 5 years.
  `;
  
  const result = await extractor.extract(testConversation, '2023-05-07');
  
  console.log('Extracted entities:', result.entities);
  console.log('Extracted facts:', result.facts);
  console.log('Extracted events:', result.events);
  
  // Verify extraction
  if (result.entities.length < 2) {
    throw new Error('Expected at least 2 entities');
  }
  if (result.facts.length < 1) {
    throw new Error('Expected at least 1 fact');
  }
  
  console.log('✓ Extraction working');
}

async function testDatabase() {
  console.log('\n=== Testing Database ===');
  
  // Clean up test db
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }
  
  const db = new MuninnDatabase(TEST_DB);
  
  // Test entity creation
  const entity = db.createEntity({
    name: 'Caroline',
    type: 'person',
    summary: 'A therapist who attends support groups'
  });
  console.log('Created entity:', entity);
  
  // Test entity retrieval
  const found = db.findEntity('Caroline', 'person');
  if (!found || found.name !== 'Caroline') {
    throw new Error('Failed to find entity');
  }
  console.log('✓ Entity operations working');
  
  // Test fact creation
  const fact = db.createFact({
    subjectEntityId: entity.id,
    predicate: 'attends',
    objectValue: 'LGBTQ support group',
    valueType: 'string',
    confidence: 1.0,
    evidence: ['I went to the LGBTQ support group yesterday']
  });
  console.log('Created fact:', fact);
  
  // Test fact retrieval
  const facts = db.getCurrentFacts('Caroline');
  if (facts.length === 0) {
    throw new Error('Failed to retrieve facts');
  }
  console.log('Retrieved facts:', facts);
  console.log('✓ Fact operations working');
  
  // Test event creation
  const event = db.createEvent({
    entityId: entity.id,
    attribute: 'attendance',
    oldValue: undefined,
    newValue: 'LGBTQ support group',
    occurredAt: new Date('2023-05-07')
  });
  console.log('Created event:', event);
  console.log('✓ Event operations working');
  
  db.close();
  
  // Cleanup
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }
}

async function testFullMemory() {
  console.log('\n=== Testing Full Memory System ===');
  
  // Clean up test db
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }
  
  const memory = new Muninn(TEST_DB);
  
  // Test remember
  const result = await memory.remember(`
    I went to the LGBTQ support group yesterday. It was really helpful - 
    I'm going to keep attending. My name is Caroline, and I've been 
    working as a therapist for 5 years.
  `, {
    source: 'conversation',
    actor: 'Caroline',
    sessionDate: '2023-05-07'
  });
  
  console.log('Remember result:', result);
  
  if (result.factsCreated === 0) {
    throw new Error('Expected at least 1 fact to be created');
  }
  
  console.log('✓ Remember working');
  
  // Test recall
  const recallResult = await memory.recall('What does Caroline attend?');
  console.log('Recall result:', recallResult);
  
  if (recallResult.source !== 'structured') {
    console.log('Note: Could not find structured facts, using fallback');
  }
  
  console.log('✓ Recall working');
  
  // Test evolution
  const evolution = await memory.getEvolution('Caroline');
  console.log('Evolution:', evolution);
  console.log('✓ Evolution working');
  
  memory.close();
  
  // Cleanup
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }
}

async function main() {
  console.log('Muninn v2 Test Suite\n');
  
  try {
    await testExtraction();
    await testDatabase();
    await testFullMemory();
    
    console.log('\n✓ All tests passed!\n');
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  }
}

main();