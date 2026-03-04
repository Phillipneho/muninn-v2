import { MuninnDatabase } from './src/database-sqlite.js';
import { existsSync, unlinkSync } from 'fs';

const dbPath = '/tmp/test-retrieval.db';
// Reuse existing DB from previous test

const db = new MuninnDatabase(dbPath);

console.log('=== Database Contents ===\n');

const entities = db['db'].prepare('SELECT * FROM entities').all();
console.log(`Entities (${entities.length}):`);
entities.forEach((e: any) => console.log(`  ${e.name} (${e.type})`));

const facts = db['db'].prepare('SELECT * FROM facts').all();
console.log(`\nFacts (${facts.length}):`);
facts.forEach((f: any) => {
  const subject = entities.find((e: any) => e.id === f.subject_entity_id)?.name || f.subject_entity_id;
  const object = f.object_value || entities.find((e: any) => e.id === f.object_entity_id)?.name || f.object_entity_id;
  console.log(`  ${subject} ${f.predicate} ${object} (validFrom: ${f.valid_from || 'none'})`);
});

db.close();
