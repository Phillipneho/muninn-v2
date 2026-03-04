// Muninn v2 Fact Extraction Pipeline
// Extract atomic facts, entities, events from conversations

import OpenAI from 'openai';
import type { ExtractionResult, ExtractedFact, ExtractedEntity, ExtractedEvent, EntityType } from './types.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const EXTRACTION_PROMPT = `You are a fact extraction system. Extract atomic facts, entities, and events from the conversation.

RULES:
1. Each fact must be a single, verifiable statement
2. Extract temporal information (when did this become true?)
3. Note confidence (1.0 = explicitly stated, 0.7 = inferred)
4. Include evidence (the exact quote from the conversation)

ENTITY TYPES: person, org, project, concept, location, technology

OUTPUT FORMAT (JSON):
{
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
      "occurredAt": "2023-05-07"
    }
  ]
}

CONVERSATION:
{conversation}

SESSION DATE: {sessionDate}

Extract facts, entities, and events. Output valid JSON only.`;

export class FactExtractor {
  
  async extract(content: string, sessionDate?: string): Promise<ExtractionResult> {
    const prompt = EXTRACTION_PROMPT
      .replace('{conversation}', content)
      .replace('{sessionDate}', sessionDate || new Date().toISOString().split('T')[0]);
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a precise fact extraction system. Output valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    });
    
    const text = response.choices[0]?.message?.content || '{}';
    
    try {
      const result = JSON.parse(text) as ExtractionResult;
      return this.validateAndClean(result);
    } catch (e) {
      console.error('Failed to parse extraction result:', e);
      return { facts: [], entities: [], events: [] };
    }
  }
  
  private validateAndClean(result: ExtractionResult): ExtractionResult {
    return {
      facts: result.facts.map(f => ({
        subject: f.subject.trim(),
        predicate: f.predicate.toLowerCase().trim().replace(/\s+/g, '_'),
        object: f.object.trim(),
        objectType: f.objectType === 'entity' ? 'entity' : 'literal',
        validFrom: f.validFrom,
        confidence: Math.min(1, Math.max(0, f.confidence || 0.8)),
        evidence: f.evidence?.trim() || ''
      })),
      entities: result.entities.map(e => ({
        name: e.name.trim(),
        type: this.validateEntityType(e.type)
      })),
      events: result.events.map(e => ({
        entity: e.entity.trim(),
        attribute: e.attribute.toLowerCase().trim().replace(/\s+/g, '_'),
        oldValue: e.oldValue?.trim(),
        newValue: e.newValue.trim(),
        occurredAt: e.occurredAt,
        cause: e.cause?.trim()
      }))
    };
  }
  
  private validateEntityType(type: string): EntityType {
    const validTypes: EntityType[] = ['person', 'org', 'project', 'concept', 'location', 'technology'];
    const normalized = type.toLowerCase().trim();
    
    // Map common variations
    const mappings: Record<string, EntityType> = {
      'person': 'person',
      'people': 'person',
      'human': 'person',
      'organization': 'org',
      'org': 'org',
      'company': 'org',
      'project': 'project',
      'task': 'project',
      'concept': 'concept',
      'idea': 'concept',
      'location': 'location',
      'place': 'location',
      'technology': 'technology',
      'tech': 'technology',
      'tool': 'technology'
    };
    
    return mappings[normalized] || 'concept';
  }
}

// Entity resolution - match entities by name similarity
export function resolveEntities(
  extracted: ExtractedEntity[],
  existing: Map<string, string> // name -> id mapping
): Map<string, string> {
  const resolved = new Map<string, string>();
  
  for (const entity of extracted) {
    const normalizedName = entity.name.toLowerCase().trim();
    
    // Exact match
    if (existing.has(normalizedName)) {
      resolved.set(entity.name, existing.get(normalizedName)!);
      continue;
    }
    
    // Fuzzy match (check for partial matches)
    for (const [existingName, existingId] of existing) {
      if (existingName.includes(normalizedName) || normalizedName.includes(existingName)) {
        resolved.set(entity.name, existingId);
        break;
      }
    }
    
    // No match - will create new
  }
  
  return resolved;
}

// Detect contradictions between new facts and existing facts
export function detectContradictions(
  newFact: ExtractedFact,
  existingFacts: ExtractedFact[]
): ExtractedFact[] {
  const contradictions: ExtractedFact[] = [];
  
  for (const existing of existingFacts) {
    // Same subject, same predicate, different object
    if (
      existing.subject.toLowerCase() === newFact.subject.toLowerCase() &&
      existing.predicate === newFact.predicate &&
      existing.object.toLowerCase() !== newFact.object.toLowerCase()
    ) {
      contradictions.push(existing);
    }
  }
  
  return contradictions;
}