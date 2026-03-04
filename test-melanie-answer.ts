import { Muninn } from './src/index.js';
import { generateAnswer } from './src/answer-generation.js';
import { readFileSync, existsSync, unlinkSync } from 'fs';

const dataset = JSON.parse(readFileSync('./benchmark/locomo10.json', 'utf-8'));
const conv = dataset[0];

const dbPath = '/tmp/test-melanie-answer.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

async function test() {
  const conversation = conv.conversation;
  const sessionKeys = Object.keys(conversation)
    .filter(k => k.startsWith('session_') && !k.includes('date_time'))
    .sort((a, b) => parseInt(a.replace('session_', '')) - parseInt(b.replace('session_', '')))
    .slice(0, 5);

  console.log('Processing 5 sessions...');
  for (const sessionKey of sessionKeys) {
    const sessionData = conversation[sessionKey];
    const sessionDate = conversation[sessionKey + '_date_time' as keyof typeof conversation];
    if (!sessionData || !Array.isArray(sessionData)) continue;
    
    const speakerA = conversation.speaker_a as string;
    const speakerB = conversation.speaker_b as string;
    
    const sessionContent = (sessionData as any[]).map((turn: any) => {
      const speaker = turn.speaker || (turn.speaker_name === 'a' ? speakerA : speakerB);
      const text = turn.text || turn.content || '';
      return speaker + ': ' + text;
    }).join('\n');
    
    await muninn.remember(sessionContent, { source: 'test', sessionDate: sessionDate as string });
  }

  // Query
  const query = 'When did Melanie paint a sunrise?';
  const result = await muninn.recall(query);

  console.log('\nQuery:', query);
  console.log('Source:', result.source);
  console.log('Facts returned:', result.facts?.length);
  if (result.facts) {
    result.facts.slice(0, 10).forEach(f => {
      const subj = f.subjectEntityId || f.subject;
      const obj = f.objectValue || f.objectEntityId || f.object;
      const date = f.validFrom ? ' (' + f.validFrom + ')' : '';
      console.log('  - ' + subj + ' ' + f.predicate + ' ' + obj + date);
    });
  }
  
  // Generate answer
  console.log('\nGenerating answer...');
  const answer = await generateAnswer(query, result);
  console.log('Answer:', answer);

  muninn.close();
}

test().catch(console.error);
