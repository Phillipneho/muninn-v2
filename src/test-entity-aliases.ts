// Test P2: Entity Aliases (The "Lish" Problem)
import { Muninn } from './index.js';
import { existsSync, unlinkSync } from 'fs';

const dbPath = '/tmp/test-entity-aliases.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

async function test() {
  console.log('=== P2: Entity Aliases Test ===\n');
  
  // 1. Create entity with canonical name
  console.log('1. Creating entity: Alisha');
  const db = muninn['db'];
  const alisha = db.createEntity({ name: 'Alisha', type: 'person' });
  console.log(`   Created: ${alisha.name} (${alisha.id})\n`);
  
  // 2. Add alias manually
  console.log('2. Adding alias: Lish → Alisha');
  db.addAlias(alisha.id, 'Lish', 'user', 1.0);
  const aliases = db.getAliases(alisha.id);
  console.log(`   Aliases: ${aliases.map(a => a.alias).join(', ')}\n`);
  
  // 3. Test resolution by alias
  console.log('3. Resolving entity by alias...');
  const resolved = db.resolveEntity('Lish');
  console.log(`   resolveEntity('Lish') → ${resolved?.name || 'NOT FOUND'}\n`);
  
  // 4. Test resolution by canonical name
  console.log('4. Resolving entity by canonical name...');
  const canonical = db.resolveEntity('Alisha');
  console.log(`   resolveEntity('Alisha') → ${canonical?.name || 'NOT FOUND'}\n`);
  
  // 5. Test case-insensitivity
  console.log('5. Testing case-insensitivity...');
  db.addAlias(alisha.id, 'Lishy', 'inferred', 0.7);
  const upper = db.resolveEntity('LISH');
  const lower = db.resolveEntity('lish');
  console.log(`   resolveEntity('LISH') → ${upper?.name || 'NOT FOUND'}`);
  console.log(`   resolveEntity('lish') → ${lower?.name || 'NOT FOUND'}\n`);
  
  // 6. Test entity extraction with alias
  console.log('6. Storing facts with alias name...');
  await muninn.remember('Lish went to the store yesterday.', { source: 'test' });
  
  const facts = db['db'].prepare(`
    SELECT f.id, e.name as subject, f.predicate, f.object_value 
    FROM facts f 
    JOIN entities e ON f.subject_entity_id = e.id
  `).all();
  
  console.log('   Facts stored:');
  facts.forEach((f: any) => {
    console.log(`   - ${f.subject}.${f.predicate} = ${f.object_value}`);
  });
  
  // 7. Query by alias
  console.log('\n7. Querying by alias...');
  const result = await muninn.recall('What did Lish do?');
  console.log(`   Source: ${result.source}`);
  console.log(`   Facts found: ${result.facts?.length || 0}`);
  if (result.facts && result.facts.length > 0) {
    result.facts.forEach(f => {
      console.log(`   - ${f.predicate} ${f.objectValue || f.objectEntityId}`);
    });
  }
  
  // 8. Test alias conflict
  console.log('\n8. Testing multiple aliases...');
  db.addAlias(alisha.id, 'Alish', 'inferred', 0.6);
  const allAliases = db.getAliases(alisha.id);
  console.log(`   All aliases for Alisha:`);
  allAliases.forEach(a => {
    console.log(`   - ${a.alias} (${a.source}, confidence: ${a.confidence})`);
  });
  
  console.log('\n=== Results ===');
  console.log(`✓ Canonical resolution: ${canonical?.name === 'Alisha' ? 'PASS' : 'FAIL'}`);
  console.log(`✓ Alias resolution: ${resolved?.name === 'Alisha' ? 'PASS' : 'FAIL'}`);
  console.log(`✓ Case-insensitive: ${upper?.name === 'Alisha' && lower?.name === 'Alisha' ? 'PASS' : 'FAIL'}`);
  
  muninn.close();
}

test().catch(console.error);