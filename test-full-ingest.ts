import { Muninn } from './src/index.js';
import { existsSync, unlinkSync } from 'fs';

const dbPath = '/tmp/test-full-ingest.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

async function test() {
  console.log('=== Full Ingestion Test ===\n');
  
  // Store session with both Caroline and Melanie
  await muninn.remember(
    `Caroline: I went to the LGBTQ support group on May 7.
     Melanie: I ran a charity race the Sunday before May 25.
     Melanie: I painted a sunrise in 2022.
     Melanie: I am a single mother of two kids.`,
    { source: 'test', sessionDate: '2023-05-08' }
  );
  
  // Check database
  const db = muninn['db'];
  const entities = db['db'].prepare('SELECT * FROM entities').all();
  console.log(`Entities (${entities.length}):`);
  entities.forEach((e: any) => console.log(`  ${e.name} (${e.type})`));
  
  const facts = db['db'].prepare('SELECT * FROM facts').all();
  console.log(`\nFacts (${facts.length}):`);
  facts.forEach((f: any) => {
    const subject = entities.find((e: any) => e.id === f.subject_entity_id)?.name || 'unknown';
    const object = f.object_value || entities.find((e: any) => e.id === f.object_entity_id)?.name || 'unknown';
    console.log(`  ${subject} ${f.predicate} ${object} (validFrom: ${f.valid_from || 'none'})`);
  });
  
  // Now query
  console.log('\n=== Query Test ===');
  const queries = [
    "When did Melanie run a charity race?",
    "What is Melanie's identity?",
    "When did Melanie paint a sunrise?"
  ];
  
  for (const q of queries) {
    console.log(`\nQuery: "${q}"`);
    const result = await muninn.recall(q);
    console.log(`  Source: ${result.source}`);
    console.log(`  Facts: ${result.facts?.length || 0}`);
    if (result.facts && result.facts.length > 0) {
      result.facts.forEach((f: any) => {
        console.log(`    - ${f.subjectEntityId || f.subject} ${f.predicate} ${f.objectValue || f.objectEntityId}`);
      });
    }
  }
  
  muninn.close();
}

test().catch(console.error);
