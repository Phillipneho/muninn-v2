// Muninn v2 Temporal Handling
// Phase 2: Bi-temporal logic, state transitions, time range queries

import type { Fact, Event } from './types.js';

// Relative date patterns and their conversions
const RELATIVE_DATE_PATTERNS: Array<{
  pattern: RegExp;
  handler: (match: RegExpMatchArray, sessionDate: Date) => Date;
}> = [
  // "yesterday"
  {
    pattern: /\byesterday\b/i,
    handler: (_, sessionDate) => {
      const d = new Date(sessionDate);
      d.setDate(d.getDate() - 1);
      return d;
    }
  },
  // "today"
  {
    pattern: /\btoday\b/i,
    handler: (_, sessionDate) => new Date(sessionDate)
  },
  // "tomorrow"
  {
    pattern: /\btomorrow\b/i,
    handler: (_, sessionDate) => {
      const d = new Date(sessionDate);
      d.setDate(d.getDate() + 1);
      return d;
    }
  },
  // "last week"
  {
    pattern: /\blast\s+week\b/i,
    handler: (_, sessionDate) => {
      const d = new Date(sessionDate);
      d.setDate(d.getDate() - 7);
      return d;
    }
  },
  // "next week"
  {
    pattern: /\bnext\s+week\b/i,
    handler: (_, sessionDate) => {
      const d = new Date(sessionDate);
      d.setDate(d.getDate() + 7);
      return d;
    }
  },
  // "last month"
  {
    pattern: /\blast\s+month\b/i,
    handler: (_, sessionDate) => {
      const d = new Date(sessionDate);
      d.setMonth(d.getMonth() - 1);
      return d;
    }
  },
  // "next month"
  {
    pattern: /\bnext\s+month\b/i,
    handler: (_, sessionDate) => {
      const d = new Date(sessionDate);
      d.setMonth(d.getMonth() + 1);
      return d;
    }
  },
  // "X days ago"
  {
    pattern: /\b(\d+)\s+days?\s+ago\b/i,
    handler: (match, sessionDate) => {
      const days = parseInt(match[1]);
      const d = new Date(sessionDate);
      d.setDate(d.getDate() - days);
      return d;
    }
  },
  // "X weeks ago"
  {
    pattern: /\b(\d+)\s+weeks?\s+ago\b/i,
    handler: (match, sessionDate) => {
      const weeks = parseInt(match[1]);
      const d = new Date(sessionDate);
      d.setDate(d.getDate() - (weeks * 7));
      return d;
    }
  },
  // "X months ago"
  {
    pattern: /\b(\d+)\s+months?\s+ago\b/i,
    handler: (match, sessionDate) => {
      const months = parseInt(match[1]);
      const d = new Date(sessionDate);
      d.setMonth(d.getMonth() - months);
      return d;
    }
  },
  // "X years ago"
  {
    pattern: /\b(\d+)\s+years?\s+ago\b/i,
    handler: (match, sessionDate) => {
      const years = parseInt(match[1]);
      const d = new Date(sessionDate);
      d.setFullYear(d.getFullYear() - years);
      return d;
    }
  },
  // "for X days/weeks/months/years" (duration, calculate start)
  {
    pattern: /\bfor\s+(\d+)\s+(days?|weeks?|months?|years?)\b/i,
    handler: (match, sessionDate) => {
      const amount = parseInt(match[1]);
      const unit = match[2].toLowerCase();
      const d = new Date(sessionDate);
      
      if (unit.startsWith('day')) d.setDate(d.getDate() - amount);
      else if (unit.startsWith('week')) d.setDate(d.getDate() - (amount * 7));
      else if (unit.startsWith('month')) d.setMonth(d.getMonth() - amount);
      else if (unit.startsWith('year')) d.setFullYear(d.getFullYear() - amount);
      
      return d;
    }
  },
  // "since X" (already handled by specific date patterns)
  {
    pattern: /\bsince\s+(\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i,
    handler: (match, _) => {
      const dateStr = match[1];
      return parseAbsoluteDate(dateStr) || new Date();
    }
  },
  // "in January/February/etc"
  {
    pattern: /\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
    handler: (match, sessionDate) => {
      const months = ['january', 'february', 'march', 'april', 'may', 'june', 
                      'july', 'august', 'september', 'october', 'november', 'december'];
      const targetMonth = months.indexOf(match[1].toLowerCase());
      const d = new Date(sessionDate);
      d.setMonth(targetMonth);
      // If target month is in the future relative to session, assume previous year
      if (targetMonth > d.getMonth()) {
        d.setFullYear(d.getFullYear() - 1);
      }
      return d;
    }
  }
];

// Absolute date patterns
const ABSOLUTE_DATE_PATTERNS: Array<{
  pattern: RegExp;
  extractor: (match: RegExpMatchArray) => Date;
}> = [
  // YYYY-MM-DD
  {
    pattern: /\b(\d{4})-(\d{2})-(\d{2})\b/,
    extractor: (match) => new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]))
  },
  // DD/MM/YYYY or MM/DD/YYYY (assume MM/DD for US context)
  {
    pattern: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/,
    extractor: (match) => new Date(parseInt(match[3]), parseInt(match[1]) - 1, parseInt(match[2]))
  },
  // Month DD, YYYY (e.g., "January 15, 2024")
  {
    pattern: /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})\b/i,
    extractor: (match) => {
      const months = ['january', 'february', 'march', 'april', 'may', 'june', 
                      'july', 'august', 'september', 'october', 'november', 'december'];
      return new Date(parseInt(match[3]), months.indexOf(match[1].toLowerCase()), parseInt(match[2]));
    }
  },
  // DD Month YYYY (e.g., "15 January 2024")
  {
    pattern: /\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i,
    extractor: (match) => {
      const months = ['january', 'february', 'march', 'april', 'may', 'june', 
                      'july', 'august', 'september', 'october', 'november', 'december'];
      return new Date(parseInt(match[3]), months.indexOf(match[2].toLowerCase()), parseInt(match[1]));
    }
  },
  // Year only (e.g., "in 2023")
  {
    pattern: /\bin\s+(\d{4})\b/,
    extractor: (match) => new Date(parseInt(match[1]), 0, 1)
  }
];

/**
 * Parse relative and absolute dates from text
 */
export function parseDate(text: string, sessionDate: Date = new Date()): Date | null {
  // Try absolute dates first
  for (const { pattern, extractor } of ABSOLUTE_DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return extractor(match);
    }
  }
  
  // Try relative dates
  for (const { pattern, handler } of RELATIVE_DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return handler(match, sessionDate);
    }
  }
  
  return null;
}

/**
 * Parse absolute date string
 */
function parseAbsoluteDate(dateStr: string): Date | null {
  for (const { pattern, extractor } of ABSOLUTE_DATE_PATTERNS) {
    const match = dateStr.match(pattern);
    if (match) {
      return extractor(match);
    }
  }
  return null;
}

/**
 * Determine if a fact is currently valid (bi-temporal check)
 */
export function isFactValid(fact: Fact, asOf: Date = new Date()): boolean {
  // Fact was invalidated
  if (fact.invalidatedAt) {
    return false;
  }
  
  // Fact hasn't started yet
  if (fact.validFrom && new Date(fact.validFrom) > asOf) {
    return false;
  }
  
  // Fact has ended
  if (fact.validUntil && new Date(fact.validUntil) <= asOf) {
    return false;
  }
  
  return true;
}

/**
 * Get fact validity period
 */
export function getValidityPeriod(fact: Fact): {
  start: Date | null;
  end: Date | null;
  duration: number | null; // in days
} {
  const start = fact.validFrom ? new Date(fact.validFrom) : null;
  const end = fact.validUntil ? new Date(fact.validUntil) : null;
  
  if (start && end) {
    const duration = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return { start, end, duration };
  }
  
  return { start, end, duration: null };
}

/**
 * Detect state transitions from a series of facts about the same entity
 */
export function detectTransitions(
  facts: Fact[],
  attribute: string
): Array<{
  from: string | null;
  to: string;
  at: Date;
  confidence: number;
}> {
  const transitions: Array<{
    from: string | null;
    to: string;
    at: Date;
    confidence: number;
  }> = [];
  
  // Sort facts by validFrom
  const sorted = facts
    .filter(f => f.predicate === attribute)
    .sort((a, b) => {
      const aDate = a.validFrom ? new Date(a.validFrom).getTime() : 0;
      const bDate = b.validFrom ? new Date(b.validFrom).getTime() : 0;
      return aDate - bDate;
    });
  
  // Detect transitions
  let previous: string | null = null;
  for (const fact of sorted) {
    if (fact.invalidatedAt) continue;
    
    const currentValue = fact.objectValue || fact.objectEntityId || null;
    
    if (previous !== null && currentValue !== previous) {
      transitions.push({
        from: previous,
        to: currentValue || '',
        at: fact.validFrom ? new Date(fact.validFrom) : new Date(),
        confidence: fact.confidence
      });
    }
    
    previous = currentValue;
  }
  
  return transitions;
}

/**
 * Calculate time overlap between two facts
 */
export function calculateOverlap(
  factA: Fact,
  factB: Fact
): { overlaps: boolean; days: number } | null {
  const startA = factA.validFrom ? new Date(factA.validFrom) : null;
  const endA = factA.validUntil ? new Date(factA.validUntil) : null;
  const startB = factB.validFrom ? new Date(factB.validFrom) : null;
  const endB = factB.validUntil ? new Date(factB.validUntil) : null;
  
  // If either fact has no time bounds, can't calculate overlap
  if (!startA || !startB) {
    return null;
  }
  
  // Calculate overlap
  const overlapStart = startA > startB ? startA : startB;
  const overlapEnd = (endA && endB) 
    ? (endA < endB ? endA : endB)
    : (endA || endB || new Date());
  
  if (overlapStart >= overlapEnd) {
    return { overlaps: false, days: 0 };
  }
  
  const days = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24));
  
  return { overlaps: true, days };
}

/**
 * Format date for display
 */
export function formatDate(date: Date | string | undefined): string {
  if (!date) return 'unknown';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
}

/**
 * Format validity period for display
 */
export function formatValidity(fact: Fact): string {
  const start = fact.validFrom ? formatDate(fact.validFrom) : 'beginning';
  const end = fact.validUntil ? formatDate(fact.validUntil) : 'now';
  
  if (fact.invalidatedAt) {
    return `invalidated on ${formatDate(fact.invalidatedAt)}`;
  }
  
  if (start === 'beginning' && end === 'now') {
    return 'always valid';
  }
  
  return `${start} to ${end}`;
}

/**
 * Time range query builder
 */
export interface TimeRange {
  from?: Date;
  to?: Date;
  asOf?: Date;  // Point-in-time query
}

/**
 * Check if a fact was true at a specific point in time
 * Note: This checks validity only, not when the fact was created.
 * For "what did the system know at time X", use wasKnownAt.
 */
export function wasTrueAt(fact: Fact, pointInTime: Date): boolean {
  // Check validity range
  if (fact.validFrom) {
    const validFrom = new Date(fact.validFrom);
    if (validFrom > pointInTime) {
      return false; // Fact not valid yet
    }
  }
  
  if (fact.validUntil) {
    const validUntil = new Date(fact.validUntil);
    if (validUntil <= pointInTime) {
      return false; // Fact already ended
    }
  }
  
  return true;
}

/**
 * Check if a fact was known (created) at a specific point in time
 * This answers "what did the system know at time X?"
 */
export function wasKnownAt(fact: Fact, pointInTime: Date): boolean {
  // Check if fact existed at that time
  const created = fact.createdAt ? new Date(fact.createdAt) : new Date(0);
  if (created > pointInTime) {
    return false; // Fact didn't exist yet
  }
  
  // Also check if it was invalidated
  if (fact.invalidatedAt) {
    const invalidated = new Date(fact.invalidatedAt);
    if (invalidated <= pointInTime) {
      return false; // Fact was already invalidated
    }
  }
  
  return true;
}

/**
 * Get the value of an attribute at a specific point in time
 */
export function getValueAtTime(
  facts: Fact[],
  attribute: string,
  pointInTime: Date
): { value: string; fact: Fact } | null {
  const relevantFacts = facts
    .filter(f => f.predicate === attribute)
    .filter(f => wasTrueAt(f, pointInTime))
    .sort((a, b) => {
      // Most recent first
      const aDate = a.validFrom ? new Date(a.validFrom).getTime() : 0;
      const bDate = b.validFrom ? new Date(b.validFrom).getTime() : 0;
      return bDate - aDate;
    });
  
  if (relevantFacts.length === 0) {
    return null;
  }
  
  const fact = relevantFacts[0];
  return {
    value: fact.objectValue || fact.objectEntityId || '',
    fact
  };
}