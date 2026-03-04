import { Muninn } from './src/index.js';
import { existsSync, unlinkSync } from 'fs';

const dbPath = '/tmp/test-temporal-dates.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

async function test() {
  console.log('=== Temporal Extraction Test ===\n');
  
  // Test session with relative date
  await muninn.remember(
    `Caroline: I went to the LGBTQ support group last Sunday.
     Caroline: I'm planning to go camping in June.
     Caroline: I gave a speech at school the week before June 9.
     Melanie: I ran a charity race the Sunday before May 25.`,
    { source: 'test', sessionDate: '2023-05-08' }
  );
  
  // Check what was stored
  const db = muninn['db'];
  const facts = db['db'].prepare('SELECT * FROM facts').all();
  
  console.log('Extracted facts with dates:');
  facts.forEach((f: any) => {
    console.log(`  ${f.predicate}: ${f.object_value || f.object_entity_id} (validFrom: ${f.valid_from || 'none'})`);
  });
  
  muninn.close();
}

test().catch(console.error);
