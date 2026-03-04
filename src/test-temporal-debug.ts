// Debug temporal extraction
import { Muninn } from './index.js';
import { existsSync, unlinkSync } from 'fs';

const dbPath = '/tmp/test-temporal-debug.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

async function test() {
  console.log('Testing temporal extraction...\n');
  
  // Store one fact
  await muninn.remember('Caroline went to the LGBTQ support group in May 2023.', {
    source: 'test',
    sessionDate: '2023-05-08'
  });
  
  // Check what was stored
  const facts = muninn['db']['db'].prepare(`
    SELECT f.id, e.name as subject, f.predicate, f.object_value, f.valid_from
    FROM facts f
    JOIN entities e ON f.subject_entity_id = e.id
  `).all();
  
  console.log('Stored facts:');
  facts.forEach((f: any) => {
    console.log(`  ${f.subject} ${f.predicate} ${f.object_value} (valid_from: ${f.valid_from})`);
  });
  
  // Test temporal extraction
  const queries = [
    'What did Caroline do in August?',
    'What did Caroline do in May?',
    'What did Caroline do in 2023?'
  ];
  
  const months = ['january', 'february', 'march', 'april', 'may', 'june',
                  'july', 'august', 'september', 'october', 'november', 'december'];
  
  for (const q of queries) {
    console.log(`\nQuery: "${q}"`);
    
    // Extract month
    const lower = q.toLowerCase();
    let foundMonth: string | null = null;
    for (const month of months) {
      if (lower.includes(month)) {
        foundMonth = month;
        break;
      }
    }
    
    if (foundMonth) {
      const monthIdx = months.indexOf(foundMonth);
      const year = 2023;
      const start = new Date(year, monthIdx, 1);
      const end = new Date(year, monthIdx + 1, 0, 23, 59, 59);
      console.log(`  Temporal bounds: ${start.toISOString()} to ${end.toISOString()}`);
      
      // Check if stored fact falls in range
      facts.forEach((f: any) => {
        if (f.valid_from) {
          const factDate = new Date(f.valid_from);
          const inRange = factDate >= start && factDate <= end;
          console.log(`  ${f.object_value}: ${factDate.toISOString()} - ${inRange ? 'IN RANGE' : 'OUT OF RANGE'}`);
        }
      });
    } else {
      console.log('  No month found');
    }
  }
  
  muninn.close();
}

test().catch(console.error);