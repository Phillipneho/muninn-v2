// Test temporal filtering
import { Muninn } from './index.js';
import { existsSync, unlinkSync } from 'fs';

const dbPath = '/tmp/test-temporal-filter.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

async function test() {
  console.log('1. Storing facts with different dates...\n');
  
  // Store facts from different time periods
  await muninn.remember('Caroline went to the LGBTQ support group in May 2023.', {
    source: 'test',
    sessionDate: '2023-05-08'
  });
  
  await muninn.remember('Caroline attended the pride parade in August 2023.', {
    source: 'test',
    sessionDate: '2023-08-15'
  });
  
  await muninn.remember('Caroline went camping in June 2023.', {
    source: 'test',
    sessionDate: '2023-06-20'
  });
  
  const stats = muninn['db'].getStats();
  console.log(`Stats: ${stats.entityCount} entities, ${stats.factCount} facts\n`);
  
  // Query with temporal intent
  console.log('2. Query: "What did Caroline do in August?"');
  const augResult = await muninn.recall('What did Caroline do in August?');
  console.log(`Source: ${augResult.source}`);
  console.log(`Facts found: ${augResult.facts?.length || 0}`);
  if (augResult.facts && augResult.facts.length > 0) {
    augResult.facts.forEach(f => {
      console.log(`  - ${f.predicate} ${f.objectValue} (valid: ${f.validFrom?.toISOString().split('T')[0] || 'unknown'})`);
    });
  }
  
  console.log('\n3. Query: "What did Caroline do in May?"');
  const mayResult = await muninn.recall('What did Caroline do in May?');
  console.log(`Source: ${mayResult.source}`);
  console.log(`Facts found: ${mayResult.facts?.length || 0}`);
  if (mayResult.facts && mayResult.facts.length > 0) {
    mayResult.facts.forEach(f => {
      console.log(`  - ${f.predicate} ${f.objectValue} (valid: ${f.validFrom?.toISOString().split('T')[0] || 'unknown'})`);
    });
  }
  
  console.log('\n4. Query: "What did Caroline do in 2023?" (no month filter)');
  const allResult = await muninn.recall('What did Caroline do in 2023?');
  console.log(`Source: ${allResult.source}`);
  console.log(`Facts found: ${allResult.facts?.length || 0}`);
  if (allResult.facts && allResult.facts.length > 0) {
    allResult.facts.forEach(f => {
      console.log(`  - ${f.predicate} ${f.objectValue} (valid: ${f.validFrom?.toISOString().split('T')[0] || 'unknown'})`);
    });
  }
  
  muninn.close();
}

test().catch(console.error);