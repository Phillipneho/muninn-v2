// Muninn v2 Answer Generation
// Uses LLM to synthesize answers from retrieved facts

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export interface RecallResult {
  source: string;
  facts?: any[];
  events?: any[];
  path?: any[];
  memories?: any[];
}

export async function generateAnswer(
  query: string,
  result: RecallResult
): Promise<string> {
  // Build context from retrieved data
  let context = '';
  
  if (result.facts && result.facts.length > 0) {
    context += 'Facts:\n';
    result.facts.forEach(f => {
      const obj = f.objectValue || f.objectEntityId || f.object || 'unknown';
      context += `- ${f.subjectEntityId || f.subject || 'unknown'} ${f.predicate} ${obj}\n`;
    });
  }
  
  if (result.events && result.events.length > 0) {
    context += '\nEvents:\n';
    result.events.forEach(e => {
      context += `- ${e.entityId || e.entity || 'unknown'}: ${e.attribute} changed from "${e.oldValue}" to "${e.newValue}"\n`;
    });
  }
  
  if (result.path && result.path.length > 0) {
    context += '\nRelationships:\n';
    result.path.forEach(p => {
      context += `- ${p.entity} → ${p.relationship} → ${p.relatedEntity}\n`;
    });
  }
  
  if (!context) {
    return "I don't have information about that.";
  }
  
  // Use LLM to synthesize answer
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a helpful assistant answering questions based on stored memory facts.
Answer concisely using ONLY the provided facts. If facts don't contain the answer, say "I don't have information about that."
Do not add information not in the facts. Be direct and factual.`
      },
      {
        role: 'user',
        content: `Question: ${query}

${context}

Answer the question using only the facts above:`
      }
    ],
    temperature: 0,
    max_tokens: 200
  });
  
  return response.choices[0]?.message?.content || "I don't have information about that.";
}