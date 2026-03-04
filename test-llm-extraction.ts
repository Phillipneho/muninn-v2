import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const content = `Caroline: I went to the LGBTQ support group on May 7.
Melanie: I ran a charity race the Sunday before May 25.
Melanie: I painted a sunrise in 2022.
Melanie: I am a single mother of two kids.`;

const sessionDate = '2023-05-08';

const prompt = `You are a precise fact extraction system. Extract atomic facts, entities, and events from conversations.

## CRITICAL: IDENTITY & STATE DETECTION (P1)
You MUST capture declarative statements about identity, relationships, and permanent states. These are NOT actions - they are facts about WHO someone IS.

Examples:
- "I am a transgender woman" → fact: {subject: "Caroline", predicate: "identity", object: "transgender woman", confidence: 1.0}
- "She identifies as non-binary" → fact: {subject: "She", predicate: "gender_identity", object: "non-binary"}
- "I'm single" → fact: {subject: "I", predicate: "relationship_status", object: "single"}
- "I'm from Sweden" → fact: {subject: "I", predicate: "from", object: "Sweden"}
- "My name is Caroline" → fact: {subject: "I", predicate: "name", object: "Caroline"}
- "I have a dog named Max" → fact: {subject: "I", predicate: "has_pet", object: "Max"}
- "I've been married for 5 years" → fact: {subject: "I", predicate: "marriage_duration", object: "5 years"}

DO NOT skip these. They are foundational identity facts, not events or actions.

## TEMPORAL PARSING
Convert relative dates to ISO dates based on the session date:
- "yesterday" → session_date - 1 day
- "last week" → session_date - 7 days
- "two days ago" → session_date - 2 days
- "last month" → session_date - 1 month
- "recently" → session_date (approximate)
- "The Sunday before May 25" → Calculate: find Sunday before the given date
- "The week before 14 August 2023" → week of Aug 7-13, 2023

## FACT EXTRACTION RULES
1. Each fact must be ATOMIC - one subject, one predicate, one object
2. Extract temporal information (validFrom)
3. Assign confidence:
   - 1.0 = explicitly stated ("I work at Acme")
   - 0.9 = strongly implied ("My company Acme...")
   - 0.7 = inferred ("The team at Acme...")
   - 0.5 = uncertain ("I think I might...")
4. Include evidence - the EXACT quote that supports the fact

OUTPUT FORMAT (JSON):
{
  "speaker": "Name of the primary speaker",
  "facts": [
    {
      "subject": "Caroline",
      "predicate": "attends",
      "object": "LGBTQ support group",
      "objectType": "entity",
      "validFrom": "2023-05-07",
      "confidence": 1.0,
      "evidence": "I went to the LGBTQ support group yesterday"
    }
  ],
  "entities": [
    {"name": "Caroline", "type": "person"},
    {"name": "LGBTQ support group", "type": "org"}
  ],
  "events": [
    {
      "entity": "Caroline",
      "attribute": "attendance",
      "oldValue": null,
      "newValue": "LGBTQ support group",
      "occurredAt": "2023-05-07",
      "cause": "seeking support"
    }
  ]
}

CONVERSATION:
"""
${content}
"""

SESSION DATE: ${sessionDate}

Extract facts, entities, and events. Resolve all coreferences. Parse temporal expressions. Output valid JSON only.`;

async function test() {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a precise fact extraction system. Output only valid JSON.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1,
    max_tokens: 2000,
    response_format: { type: 'json_object' }
  });
  
  console.log('=== LLM Response ===\n');
  console.log(response.choices[0]?.message?.content);
}

test().catch(console.error);
