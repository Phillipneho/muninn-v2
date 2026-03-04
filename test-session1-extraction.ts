import { FactExtractor } from './src/extraction.js';

const extractor = new FactExtractor();

async function test() {
  console.log('=== Session 1 Full Extraction ===\n');
  
  // Full session 1 content from LOCOMO
  const content = `Melanie: Hey Caroline! Good to see you! I'm swamped with the kids & work. What's up with you? Anything new?
Caroline: Hey Melanie! I just got back from this awesome LGBTQ support group meeting. It was so empowering - everyone was so supportive!
Melanie: Wow, that's cool, Caroline! What happened that was so awesome? Did you hear any inspiring stories?
Caroline: Yeah, I went to the LGBTQ support group on May 7. We talked about how to be a good ally, and I shared my story of being a transgender woman.
Melanie: Wow, love that painting! So cool you found such a helpful group. What's it done for you?
Caroline: The support group has been amazing. I've found so much community and acceptance there.
Melanie: That's really cool. You've got guts. What now?
Caroline: I'm thinking about pursuing counseling or mental health work. I want to help others like me.
Melanie: You'd be a great counselor! Your empathy and understanding will really help the people you work with.
Caroline: Thanks, Melanie! That's really sweet. Is this your own painting?
Melanie: Yeah, I painted that lake sunrise last year! It's special to me.
Caroline: Wow, Melanie! The colors really blend nicely. Painting looks like a great outlet for expressing your...
Melanie: Thanks, Caroline! Painting's a fun way to express my feelings and get creative. It's a great way to...
Melanie: Yep, Caroline. Taking care of ourselves is vital. I'm off to go swimming with the kids. Talk to you...`;

  const result = await extractor.extract(content, '2023-05-08');
  
  console.log('Entities (' + result.entities.length + '):');
  result.entities.forEach(e => console.log(`  ${e.name} (${e.type})`));
  
  console.log('\nFacts (' + result.facts.length + '):');
  result.facts.forEach(f => {
    console.log(`  ${f.subject} ${f.predicate} ${f.object}`);
    console.log(`    validFrom: ${f.validFrom || 'MISSING'}`);
    console.log(`    evidence: ${f.evidence}`);
  });
  
  console.log('\nEvents (' + result.events.length + '):');
  result.events.forEach(e => {
    console.log(`  ${e.entity}.${e.attribute}: ${e.oldValue} → ${e.newValue}`);
    console.log(`    occurredAt: ${e.occurredAt || 'MISSING'}`);
  });
}

test().catch(console.error);
