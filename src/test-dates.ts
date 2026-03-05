import { Muninn } from './index-unified.js';

async function main() {
  const dbPath = '/tmp/test-dates.db';
  const muninn = new Muninn(dbPath);

  // Test 1: Explicit date
  await muninn.remember("Caroline: I went to the LGBTQ support group on May 7.", { 
    sessionDate: "2023-05-08" 
  });

  // Test 2: Relative date (yesterday)
  await muninn.remember("Caroline: I went to a LGBTQ support group yesterday.", { 
    sessionDate: "2023-05-08" 
  });

  // Test 3: Without session date
  await muninn.remember("Caroline: I went to the LGBTQ support group last year.", { 
    sessionDate: "2023-05-08" 
  });

  // Check what's stored
  const db = muninn.getDatabase();
  const obs = db.getObservationsByEntity(db.resolveEntity('Caroline')!.id);

  console.log('\n=== Stored Observations ===');
  for (const o of obs) {
    console.log(`- ${o.predicate}: ${o.object_value} (valid_from: ${o.valid_from}, tags: ${o.tags})`);
  }

  muninn.close();
}

main().catch(console.error);
