// Muninn v2 Temporal Handling Tests
// Phase 2: Bi-temporal logic, state transitions, time range queries

import {
  parseDate,
  isFactValid,
  getValidityPeriod,
  detectTransitions,
  calculateOverlap,
  wasTrueAt,
  getValueAtTime,
  formatDate,
  formatValidity
} from './temporal.js';
import type { Fact } from './types.js';

// Test facts for temporal queries
const createTestFact = (overrides: Partial<Fact> = {}): Fact => ({
  id: 'test-fact-' + Math.random().toString(36).slice(2),
  subjectEntityId: 'entity-1',
  predicate: 'attends',
  objectValue: 'LGBTQ support group',
  valueType: 'string',
  confidence: 1.0,
  createdAt: new Date('2024-01-01'),
  ...overrides
});

async function testDateParsing() {
  console.log('\n=== Test: Date Parsing ===');
  
  // Absolute dates
  const isoDate = parseDate('The event was on 2024-03-15');
  if (!isoDate || formatDate(isoDate) !== '2024-03-15') {
    throw new Error(`Expected 2024-03-15, got ${isoDate ? formatDate(isoDate) : 'null'}`);
  }
  console.log('✓ ISO date parsing works');
  
  const monthDayYear = parseDate('She joined on January 15, 2024');
  if (!monthDayYear || formatDate(monthDayYear) !== '2024-01-15') {
    throw new Error(`Expected 2024-01-15, got ${monthDayYear ? formatDate(monthDayYear) : 'null'}`);
  }
  console.log('✓ Month Day Year parsing works');
  
  // Relative dates
  const sessionDate = new Date('2024-03-15');
  
  const yesterday = parseDate('I went yesterday', sessionDate);
  if (!yesterday || formatDate(yesterday) !== '2024-03-14') {
    throw new Error(`Expected 2024-03-14, got ${yesterday ? formatDate(yesterday) : 'null'}`);
  }
  console.log('✓ Relative date "yesterday" works');
  
  const lastWeek = parseDate('It happened last week', sessionDate);
  if (!lastWeek || formatDate(lastWeek) !== '2024-03-08') {
    throw new Error(`Expected 2024-03-08, got ${lastWeek ? formatDate(lastWeek) : 'null'}`);
  }
  console.log('✓ Relative date "last week" works');
  
  const daysAgo = parseDate('5 days ago', sessionDate);
  if (!daysAgo || formatDate(daysAgo) !== '2024-03-10') {
    throw new Error(`Expected 2024-03-10, got ${daysAgo ? formatDate(daysAgo) : 'null'}`);
  }
  console.log('✓ Relative date "5 days ago" works');
  
  const monthsAgo = parseDate('3 months ago', sessionDate);
  if (!monthsAgo || formatDate(monthsAgo) !== '2023-12-15') {
    throw new Error(`Expected 2023-12-15, got ${monthsAgo ? formatDate(monthsAgo) : 'null'}`);
  }
  console.log('✓ Relative date "3 months ago" works');
  
  const yearsAgo = parseDate('2 years ago', sessionDate);
  if (!yearsAgo || formatDate(yearsAgo) !== '2022-03-15') {
    throw new Error(`Expected 2022-03-15, got ${yearsAgo ? formatDate(yearsAgo) : 'null'}`);
  }
  console.log('✓ Relative date "2 years ago" works');
  
  const duration = parseDate('for 5 years', sessionDate);
  if (!duration || formatDate(duration) !== '2019-03-15') {
    throw new Error(`Expected 2019-03-15, got ${duration ? formatDate(duration) : 'null'}`);
  }
  console.log('✓ Duration "for 5 years" works');
  
  console.log('✓ Date parsing complete\n');
}

async function testFactValidity() {
  console.log('\n=== Test: Fact Validity ===');
  
  // Currently valid fact
  const validFact = createTestFact({
    validFrom: new Date('2024-01-01'),
    validUntil: undefined
  });
  
  if (!isFactValid(validFact)) {
    throw new Error('Expected fact to be valid');
  }
  console.log('✓ Currently valid fact detected');
  
  // Expired fact
  const expiredFact = createTestFact({
    validFrom: new Date('2024-01-01'),
    validUntil: new Date('2024-02-01')
  });
  
  if (isFactValid(expiredFact)) {
    throw new Error('Expected expired fact to be invalid');
  }
  console.log('✓ Expired fact detected');
  
  // Future fact
  const futureFact = createTestFact({
    validFrom: new Date('2027-01-01')
  });
  
  if (isFactValid(futureFact)) {
    throw new Error('Expected future fact to be invalid');
  }
  console.log('✓ Future fact detected');
  
  // Invalidated fact
  const invalidatedFact = createTestFact({
    invalidatedAt: new Date('2024-02-01')
  });
  
  if (isFactValid(invalidatedFact)) {
    throw new Error('Expected invalidated fact to be invalid');
  }
  console.log('✓ Invalidated fact detected');
  
  // Point-in-time validity
  const historicalFact = createTestFact({
    validFrom: new Date('2024-01-01'),
    validUntil: new Date('2024-03-01')
  });
  
  const wasTrue = wasTrueAt(historicalFact, new Date('2024-02-15'));
  if (!wasTrue) {
    throw new Error('Expected fact to be true on 2024-02-15');
  }
  console.log('✓ Point-in-time validity (within range)');
  
  const wasFalse = wasTrueAt(historicalFact, new Date('2024-04-01'));
  if (wasFalse) {
    throw new Error('Expected fact to be false on 2024-04-01');
  }
  console.log('✓ Point-in-time validity (outside range)');
  
  console.log('✓ Fact validity complete\n');
}

async function testValidityPeriod() {
  console.log('\n=== Test: Validity Period ===');
  
  const finiteFact = createTestFact({
    validFrom: new Date('2024-01-01'),
    validUntil: new Date('2024-03-01')
  });
  
  const period = getValidityPeriod(finiteFact);
  
  if (!period.start || formatDate(period.start) !== '2024-01-01') {
    throw new Error('Expected start date 2024-01-01');
  }
  
  if (!period.end || formatDate(period.end) !== '2024-03-01') {
    throw new Error('Expected end date 2024-03-01');
  }
  
  if (period.duration !== 60) {
    throw new Error(`Expected duration 60 days, got ${period.duration}`);
  }
  
  console.log('✓ Validity period calculation works');
  console.log('✓ Validity period complete\n');
}

async function testStateTransitions() {
  console.log('\n=== Test: State Transitions ===');
  
  // Risk level progression
  const riskFacts: Fact[] = [
    createTestFact({
      predicate: 'risk_level',
      objectValue: 'Low',
      validFrom: new Date('2024-01-01'),
      validUntil: new Date('2024-02-01')
    }),
    createTestFact({
      predicate: 'risk_level',
      objectValue: 'Medium',
      validFrom: new Date('2024-02-01'),
      validUntil: new Date('2024-03-01')
    }),
    createTestFact({
      predicate: 'risk_level',
      objectValue: 'High',
      validFrom: new Date('2024-03-01')
    })
  ];
  
  const transitions = detectTransitions(riskFacts, 'risk_level');
  
  if (transitions.length !== 2) {
    throw new Error(`Expected 2 transitions, got ${transitions.length}`);
  }
  
  // First transition: Low -> Medium
  if (transitions[0].from !== 'Low' || transitions[0].to !== 'Medium') {
    throw new Error(`Expected Low -> Medium, got ${transitions[0].from} -> ${transitions[0].to}`);
  }
  console.log('✓ First transition: Low -> Medium');
  
  // Second transition: Medium -> High
  if (transitions[1].from !== 'Medium' || transitions[1].to !== 'High') {
    throw new Error(`Expected Medium -> High, got ${transitions[1].from} -> ${transitions[1].to}`);
  }
  console.log('✓ Second transition: Medium -> High');
  
  console.log('✓ State transitions complete\n');
}

async function testTimeOverlap() {
  console.log('\n=== Test: Time Overlap ===');
  
  // Overlapping facts
  const factA = createTestFact({
    validFrom: new Date('2024-01-01'),
    validUntil: new Date('2024-03-01')
  });
  
  const factB = createTestFact({
    validFrom: new Date('2024-02-01'),
    validUntil: new Date('2024-04-01')
  });
  
  const overlap = calculateOverlap(factA, factB);
  
  if (!overlap || !overlap.overlaps) {
    throw new Error('Expected facts to overlap');
  }
  
  if (overlap.days !== 29) {
    throw new Error(`Expected 29 days overlap, got ${overlap.days}`);
  }
  console.log('✓ Overlapping facts detected correctly');
  
  // Non-overlapping facts
  const factC = createTestFact({
    validFrom: new Date('2024-01-01'),
    validUntil: new Date('2024-02-01')
  });
  
  const factD = createTestFact({
    validFrom: new Date('2024-03-01'),
    validUntil: new Date('2024-04-01')
  });
  
  const noOverlap = calculateOverlap(factC, factD);
  
  if (noOverlap && noOverlap.overlaps) {
    throw new Error('Expected facts not to overlap');
  }
  console.log('✓ Non-overlapping facts detected correctly');
  
  console.log('✓ Time overlap complete\n');
}

async function testValueAtTime() {
  console.log('\n=== Test: Value At Time ===');
  
  const facts: Fact[] = [
    createTestFact({
      predicate: 'employer',
      objectValue: 'Company A',
      validFrom: new Date('2020-01-01'),
      validUntil: new Date('2022-06-01')
    }),
    createTestFact({
      predicate: 'employer',
      objectValue: 'Company B',
      validFrom: new Date('2022-06-01')
    })
  ];
  
  // Value in 2021 (Company A era)
  const value2021 = getValueAtTime(facts, 'employer', new Date('2021-06-01'));
  if (!value2021 || value2021.value !== 'Company A') {
    throw new Error(`Expected 'Company A' in 2021, got ${value2021?.value}`);
  }
  console.log('✓ Correct employer for 2021');
  
  // Value in 2023 (Company B era)
  const value2023 = getValueAtTime(facts, 'employer', new Date('2023-06-01'));
  if (!value2023 || value2023.value !== 'Company B') {
    throw new Error(`Expected 'Company B' in 2023, got ${value2023?.value}`);
  }
  console.log('✓ Correct employer for 2023');
  
  // Value before any facts
  const value2019 = getValueAtTime(facts, 'employer', new Date('2019-06-01'));
  if (value2019 !== null) {
    throw new Error('Expected null for 2019 (before any facts)');
  }
  console.log('✓ Null for time before any facts');
  
  console.log('✓ Value at time complete\n');
}

async function testFormatValidity() {
  console.log('\n=== Test: Format Validity ===');
  
  // Open-ended fact
  const openFact = createTestFact({
    validFrom: new Date('2024-01-01')
  });
  const openFormatted = formatValidity(openFact);
  if (openFormatted !== '2024-01-01 to now') {
    throw new Error(`Expected '2024-01-01 to now', got '${openFormatted}'`);
  }
  console.log('✓ Open-ended validity formatted correctly');
  
  // Fixed range
  const fixedFact = createTestFact({
    validFrom: new Date('2024-01-01'),
    validUntil: new Date('2024-03-01')
  });
  const fixedFormatted = formatValidity(fixedFact);
  if (fixedFormatted !== '2024-01-01 to 2024-03-01') {
    throw new Error(`Expected '2024-01-01 to 2024-03-01', got '${fixedFormatted}'`);
  }
  console.log('✓ Fixed range formatted correctly');
  
  // Invalidated fact
  const invalidFact = createTestFact({
    invalidatedAt: new Date('2024-02-15')
  });
  const invalidFormatted = formatValidity(invalidFact);
  if (!invalidFormatted.includes('invalidated')) {
    throw new Error(`Expected invalidated message, got '${invalidFormatted}'`);
  }
  console.log('✓ Invalidated fact formatted correctly');
  
  console.log('✓ Format validity complete\n');
}

async function main() {
  console.log('Muninn v2 Phase 2 Tests\n');
  console.log('Testing temporal handling with:');
  console.log('- Date parsing (absolute and relative)');
  console.log('- Fact validity checks');
  console.log('- State transitions');
  console.log('- Time overlap detection');
  console.log('- Point-in-time queries\n');
  
  try {
    await testDateParsing();
    await testFactValidity();
    await testValidityPeriod();
    await testStateTransitions();
    await testTimeOverlap();
    await testValueAtTime();
    await testFormatValidity();
    
    console.log('\n✓ All Phase 2 tests passed!\n');
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  }
}

main();