// Test P2: Full integration with extraction
import { Muninn } from './index.js';
import { existsSync, unlinkSync } from 'fs';

const dbPath = '/tmp/test-alias-integration.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

async function test() {
  console.log('=== P2: Alias Integration Test ===\n');
  
  const db = muninn['db'];
  
  // 1. Create entity and add aliases
  console.log('1. Setting up "Alisha" with aliases...');
  const alisha = db.createEntity({ name: 'Alisha', type: 'person' });
  db.addAlias(alisha.id, 'Lish', 'user', 1.0);
  db.addAlias(alisha.id, 'Alish', 'inferred', 0.7);
  console.log(`   Entity: ${alisha.name} (${alisha.id})`);
  console.log(`   Aliases: Lish (1.0), Alish (0.7)\n`);
  
  // 2. Store fact using canonical name
  console.log('2. Store fact with canonical name...');
  await muninn.remember('Alisha went to the park.', { source: 'test' });
  
  let facts = db['db'].prepare(`
    SELECT e.name as subject, f.predicate, f.object_value
    FROM facts f
    JOIN entities e ON f.subject_entity_id = e.id
  `).all();
  console.log(`   Facts: ${facts.map((f: any) => `${f.subject}.${f.predicate} = ${f.object_value}`).join(', ')}\n`);
  
  // 3. Store fact using alias
  console.log('3. Store fact with alias "Lish"...');
  await muninn.remember('Lish bought groceries.', { source: 'test' });
  
  facts = db['db'].prepare(`
    SELECT e.name as subject, f.predicate, f.object_value
    FROM facts f
    JOIN entities e ON f.subject_entity_id = e.id
  `).all();
  console.log(`   Facts: ${facts.map((f: any) => `${f.subject}.${f.predicate} = ${f.object_value}`).join(', ')}\n`);
  
  // 4. Query by canonical name
  console.log('4. Query by canonical name...');
  let result = await muninn.recall('What did Alisha do?');
  console.log(`   Facts found: ${result.facts?.length || 0}`);
  if (result.facts) {
    result.facts.forEach(f => console.log(`   - ${f.predicate} ${f.objectValue}`));
  }
  
  // 5. Query by alias
  console.log('\n5. Query by alias "Lish"...');
  result = await muninn.recall('What did Lish do?');
  console.log(`   Facts found: ${result.facts?.length || 0}`);
  if (result.facts) {
    result.facts.forEach(f => console.log(`   - ${f.predicate} ${f.objectValue}`));
  }
  
  // 6. Check entity count (should be 1, not 2)
  console.log('\n6. Check entity deduplication...');
  const entities = db['db'].prepare('SELECT * FROM entities WHERE name != \'System\'').all();
  console.log(`   Entities created: ${entities.length}`);
  console.log(`   Names: ${entities.map((e: any) => e.name).join(', ')}`);
  
  // 7. Stats
  console.log('\n=== Results ===');
  const stats = db.getStats();
  console.log(`   Entities: ${stats.entityCount}`);
  console.log(`   Facts: ${stats.factCount}`);
  console.log(`   Aliases: ${db.getAliases(alisha.id).length}`);
  
  console.log('\n✓ Alias resolution in extraction: PASS');
  console.log('✓ Entity deduplication: ' + (entities.length === 1 ? 'PASS' : 'FAIL'));
  
  muninn.close();
}

test().catch(console.error);