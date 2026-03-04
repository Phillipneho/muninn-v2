import { readFileSync } from 'fs';

const dataset = JSON.parse(readFileSync('./benchmark/locomo10.json', 'utf-8'));
const conv = dataset[0];

const conversation = conv.conversation;
const sessionKeys = Object.keys(conversation)
  .filter(k => k.startsWith('session_') && !k.includes('date_time'))
  .sort((a, b) => parseInt(a.replace('session_', '')) - parseInt(b.replace('session_', '')))
  .slice(0, 5);

const speakerA = conversation.speaker_a as string;
const speakerB = conversation.speaker_b as string;

for (const sessionKey of sessionKeys) {
  console.log(`\n=== ${sessionKey} ===`);
  const sessionData = conversation[sessionKey];
  if (!sessionData || !Array.isArray(sessionData)) continue;
  
  for (const turn of sessionData as any[]) {
    const speaker = turn.speaker || (turn.speaker_name === 'a' ? speakerA : speakerB);
    const text = turn.text || turn.content || '';
    if (speaker.includes('Melanie') || text.toLowerCase().includes('paint') || text.toLowerCase().includes('sunrise') || text.toLowerCase().includes('charity')) {
      console.log(`${speaker}: ${text.substring(0, 100)}...`);
    }
  }
}
