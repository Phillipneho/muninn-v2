import { Muninn } from './src/index.js';
import { existsSync, unlinkSync } from 'fs';

const dbPath = '/tmp/test-session1-only.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

async function test() {
  console.log('=== Session 1 Only Ingestion ===\n');
  
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

  const result = await muninn.remember(content, { source: 'test', sessionDate: '2023-05-08' });
  
  console.log('Entities created:', result.entitiesCreated);
  console.log('Facts created:', result.factsCreated);
  console.log('Events created:', result.eventsCreated);
  
  // Check DB
  const db = muninn['db'];
  const entities = db['db'].prepare('SELECT * FROM entities').all();
  const facts = db['db'].prepare('SELECT f.predicate, f.object_value, e.name as entity FROM facts f JOIN entities e ON f.subject_entity_id = e.id').all();
  
  console.log('\nEntities:', entities.map((e: any) => e.name).join(', '));
  console.log('\nFacts:');
  facts.forEach((f: any) => {
    console.log(`  ${f.entity} ${f.predicate} ${f.object_value || ''}`);
  });
  
  muninn.close();
}

test().catch(console.error);
