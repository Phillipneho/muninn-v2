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

/**
 * Generate answer with temporal context
 */
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
      const date = f.validFrom ? ` (on ${formatDate(f.validFrom)})` : '';
      context += `- ${f.subjectEntityId || f.subject || 'Unknown'} ${f.predicate} ${obj}${date}\n`;
    });
  }
  
  if (result.events && result.events.length > 0) {
    context += '\nEvents:\n';
    result.events.forEach(e => {
      const date = e.occurredAt ? ` on ${formatDate(e.occurredAt)}` : '';
      context += `- ${e.entityId || e.entity || 'Unknown'}: ${e.attribute} changed from "${e.oldValue}" to "${e.newValue}"${date}\n`;
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
  
  // Detect temporal intent from query
  const isTemporalQuery = /\b(when|date|time|year|month|week|day|ago|before|after|last|next|during|in)\b/i.test(query);
  
  // Use LLM to synthesize answer
  const systemPrompt = isTemporalQuery
    ? `You are a helpful assistant answering questions about events and dates.
Use ONLY the provided facts. Pay special attention to dates - they are critical.
Format dates naturally (e.g., "May 7, 2023" not "2023-05-07").
If the fact mentions a date, include it in your answer.
If no date is found, say "I don't have that specific date."`
    : `You are a helpful assistant answering questions based on stored memory facts.
Answer concisely using ONLY the provided facts.
If facts don't contain the answer, say "I don't have information about that."
Do not add information not in the facts. Be direct and factual.`;
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: systemPrompt
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

/**
 * Format date for natural language
 */
function formatDate(dateStr: string | Date): string {
  try {
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    
    // Check if it's a valid date
    if (isNaN(date.getTime())) {
      return dateStr.toString();
    }
    
    return `${month} ${day}, ${year}`;
  } catch {
    return dateStr.toString();
  }
}