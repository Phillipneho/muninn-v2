import { FactExtractor } from './src/extraction.js';

const extractor = new FactExtractor();

async function test() {
  console.log('=== Testing Extraction of Painting ===\n');
  
  const content = `Melanie: Yeah, I painted that lake sunrise last year! It's special to me.
Melanie: Thanks, Caroline! Painting's a fun way to express my feelings and get creative.`;

  const result = await extractor.extract(content, '2023-05-08');
  
  console.log('Entities:');
  result.entities.forEach(e => console.log(`  ${e.name} (${e.type})`));
  
  console.log('\nFacts:');
  result.facts.forEach(f => {
    console.log(`  ${f.subject} ${f.predicate} ${f.object}`);
    console.log(`    validFrom: ${f.validFrom || 'MISSING'}`);
  });
  
  console.log('\nEvents:');
  result.events.forEach(e => {
    console.log(`  ${e.entity}.${e.attribute}: ${e.oldValue} → ${e.newValue}`);
    console.log(`    occurredAt: ${e.occurredAt || 'MISSING'}`);
  });
}

test().catch(console.error);
