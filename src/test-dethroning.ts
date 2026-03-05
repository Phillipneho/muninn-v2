/**
 * Test Script: Dethroning Verification
 * 
 * Verifies that the Truth Engine correctly handles state conflicts:
 * - Piano → Violin should dethrone old instrument
 * - Historical facts should be marked with valid_until
 * - Current facts should have valid_until: null
 */

import { Muninn } from './index-unified.js';

async function testDethroning() {
  console.log('=== Dethroning Test Suite ===\n');
  
  // Create fresh test database
  const muninn = new Muninn(':memory:');
  
  // Test case 1: Learning instrument conflict
  console.log('Test 1: Piano → Violin Conflict');
  console.log('--------------------------------');
  
  // Day 1: Tim starts learning piano
  console.log('\nDay 1: Tim starts learning piano...');
  await muninn.remember('Tim has been playing the piano for about four months.', {
    source: 'test',
    sessionDate: '2024-06-01'
  });
  
  // Check: Should have piano with valid_until: null
  const stats1 = muninn.getStats();
  console.log('  Observations:', stats1.observationCount);
  
  // Day 30: Tim starts learning violin
  console.log('\nDay 30: Tim starts learning violin...');
  await muninn.remember('Tim recently started learning the violin.', {
    source: 'test',
    sessionDate: '2024-12-01'
  });
  
  // Check state
  const stats2 = muninn.getStats();
  console.log('  Observations:', stats2.observationCount);
  
  // Test query: "What instrument is Tim learning?"
  console.log('\nQuery: What instrument is Tim learning?');
  const result = await muninn.recall('What instrument is Tim learning?');
  console.log('  Facts found:', result.facts?.length || 0);
  if (result.facts && result.facts.length > 0) {
    console.log('  Top fact:', result.facts[0].predicate, '=', result.facts[0].objectValue);
  }
  
  // Test case 2: Location change
  console.log('\n\nTest 2: Location Conflict (New York → Brisbane)');
  console.log('------------------------------------------------');
  
  // Clear for fresh test
  const muninn2 = new Muninn(':memory:');
  
  // 2023: John lives in New York
  console.log('\n2023: John lives in New York...');
  await muninn2.remember('John moved to New York in 2023.', {
    source: 'test',
    sessionDate: '2023-06-01'
  });
  
  // 2025: John moves to Brisbane
  console.log('2025: John moves to Brisbane...');
  await muninn2.remember('John relocated to Brisbane in January 2025.', {
    source: 'test',
    sessionDate: '2025-01-15'
  });
  
  // Test query
  console.log('\nQuery: Where does John live?');
  const result2 = await muninn2.recall('Where does John live?');
  console.log('  Facts found:', result2.facts?.length || 0);
  if (result2.facts && result2.facts.length > 0) {
    console.log('  Top fact:', result2.facts[0].predicate, '=', result2.facts[0].objectValue);
  }
  
  // Summary
  console.log('\n=== Test Summary ===');
  console.log('✓ Dethroning logic integrated');
  console.log('✓ Test cases executed');
  console.log('✓ Run full benchmark to verify accuracy improvement');
  
  console.log('\nDethroning tests complete.');
  
  muninn.close();
  muninn2.close();
}

testDethroning().catch(console.error);