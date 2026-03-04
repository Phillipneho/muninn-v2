import { FactExtractor } from './src/extraction.js';

const extractor = new FactExtractor();

async function test() {
  console.log('=== Extraction Debug ===\n');
  
  const content = `Caroline: I went to the LGBTQ support group on May 7.
Melanie: I ran a charity race the Sunday before May 25.
Melanie: I painted a sunrise in 2022.
Melanie: I am a single mother of two kids.`;

  const result = await extractor.extract(content, '2023-05-08');
  
  console.log('Entities:');
  result.entities.forEach(e => console.log(`  ${e.name} (${e.type})`));
  
  console.log('\nFacts:');
  result.facts.forEach(f => {
    console.log(`  ${f.subject} ${f.predicate} ${f.object}`);
    console.log(`    validFrom: ${f.validFrom || 'MISSING'}`);
    console.log(`    confidence: ${f.confidence}`);
    console.log(`    evidence: ${f.evidence}`);
  });
  
  console.log('\nEvents:');
  result.events.forEach(e => {
    console.log(`  ${e.entity}.${e.attribute}: ${e.oldValue} → ${e.newValue}`);
    console.log(`    occurredAt: ${e.occurredAt || 'MISSING'}`);
  });
}

test().catch(console.error);
