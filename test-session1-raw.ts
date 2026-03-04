import { FactExtractor } from './src/extraction.js';

const extractor = new FactExtractor();

async function test() {
  // Exact text from LOCOMO session 1
  const content = `Melanie: Yeah, I painted that lake sunrise last year! It's special to me.`;
  
  console.log('Content:', content);
  console.log('Session date: 2023-05-08\n');
  
  const result = await extractor.extract(content, '2023-05-08');
  
  console.log('Extracted facts:', result.facts.length);
  result.facts.forEach(f => {
    console.log(`  ${f.subject} ${f.predicate} ${f.object} (${f.validFrom || 'no date'})`);
  });
  
  console.log('\nExtracted events:', result.events.length);
  result.events.forEach(e => {
    console.log(`  ${e.entity}.${e.attribute}: ${e.newValue} (${e.occurredAt || 'no date'})`);
  });
}

test().catch(console.error);
