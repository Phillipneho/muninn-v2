import { Muninn } from './src/index.js';
import { existsSync, unlinkSync } from 'fs';

const dbPath = '/tmp/test-retrieval.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

async function test() {
  console.log('=== Retrieval Test ===\n');
  
  // Store session
  await muninn.remember(
    `Caroline: I ran a charity race the Sunday before May 25.
     Caroline: I went to the LGBTQ support group on May 7.
     Melanie: I painted a sunrise in 2022.`,
    { source: 'test', sessionDate: '2023-05-08' }
  );
  
  // Test queries
  const queries = [
    "When did Melanie run a charity race?",
    "When did Melanie paint a sunrise?",
    "When did Caroline go to the LGBTQ support group?"
  ];
  
  for (const q of queries) {
    console.log(`\nQuery: "${q}"`);
    const result = await muninn.recall(q);
    console.log(`  Source: ${result.source}`);
    console.log(`  Facts: ${result.facts?.length || 0}`);
    if (result.facts) {
      result.facts.slice(0, 3).forEach((f: any) => {
        console.log(`    - ${f.subjectEntityId || f.subject} ${f.predicate} ${f.objectValue || f.objectEntityId || f.object} (${f.validFrom || 'no date'})`);
      });
    }
  }
  
  muninn.close();
}

test().catch(console.error);
