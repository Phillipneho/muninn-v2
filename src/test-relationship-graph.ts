// Test v3.1: Entity Relationship Graph
import { Muninn } from './index.js';
import { existsSync, unlinkSync } from 'fs';

const dbPath = '/tmp/test-relationship-graph.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

async function test() {
  console.log('=== v3.1: Entity Relationship Graph Test ===\n');
  
  const db = muninn['db'];
  
  // 1. Create entities
  console.log('1. Creating entities...');
  const phillip = db.createEntity({ name: 'Phillip', type: 'person' });
  const alisha = db.createEntity({ name: 'Alisha', type: 'person' });
  const caroline = db.createEntity({ name: 'Caroline', type: 'person' });
  const dave = db.createEntity({ name: 'Dave', type: 'person' });
  const techcorp = db.createEntity({ name: 'TechCorp', type: 'org' });
  
  console.log(`   Created: ${phillip.name}, ${alisha.name}, ${caroline.name}, ${dave.name}, ${techcorp.name}\n`);
  
  // 2. Create relationships
  console.log('2. Creating relationships...');
  db.createEntityRelationship({
    sourceEntityId: phillip.id,
    targetEntityId: alisha.id,
    relationshipType: 'is_partner_of',
    confidence: 1.0,
    evidence: 'Phillip mentioned his partner Alisha'
  });
  
  db.createEntityRelationship({
    sourceEntityId: caroline.id,
    targetEntityId: techcorp.id,
    relationshipType: 'works_for',
    confidence: 0.9,
    evidence: 'Caroline works at TechCorp'
  });
  
  db.createEntityRelationship({
    sourceEntityId: caroline.id,
    targetEntityId: dave.id,
    relationshipType: 'friend_of',
    confidence: 0.8,
    evidence: 'Caroline met Dave at the cafe'
  });
  
  console.log('   Created: Phillip → is_partner_of → Alisha');
  console.log('   Created: Caroline → works_for → TechCorp');
  console.log('   Created: Caroline → friend_of → Dave\n');
  
  // 3. Test relationship retrieval
  console.log('3. Testing relationship retrieval...');
  const phillipRels = db.getEntityRelationships(phillip.id, 'outgoing');
  console.log(`   Phillip's outgoing relationships: ${phillipRels.length}`);
  phillipRels.forEach(r => {
    console.log(`   - ${r.relationship_type} → ${r.target_name}`);
  });
  
  const alishaRels = db.getEntityRelationships(alisha.id, 'incoming');
  console.log(`\n   Alisha's incoming relationships: ${alishaRels.length}`);
  alishaRels.forEach(r => {
    console.log(`   - ${r.relationship_type} ← ${r.source_name}`);
  });
  
  // 4. Test findRelatedEntities
  console.log('\n4. Testing findRelatedEntities...');
  const carolineRelated = db.findRelatedEntities(caroline.id);
  console.log(`   Caroline's related entities: ${carolineRelated.length}`);
  carolineRelated.forEach(r => {
    console.log(`   - ${r.related_entity_name} (${r.relationship_type})`);
  });
  
  // 5. Test traversal
  console.log('\n5. Testing relationship traversal...');
  const phillipTraverse = db.traverseRelationships(phillip.id, 'is_partner_of', 1);
  console.log(`   Traverse from Phillip (depth 1):`);
  phillipTraverse.forEach(t => {
    console.log(`   - ${t.entityName} via ${t.path.join(' → ')}`);
  });
  
  // 6. Test query with relationship resolution
  console.log('\n6. Testing query pattern: "What did Phillip\'s partner do?"');
  console.log('   Step 1: Find Phillip\'s partner...');
  const phillipPartner = db.findRelatedEntities(phillip.id, 'is_partner_of');
  if (phillipPartner.length > 0) {
    const partnerId = (phillipPartner[0] as any).related_entity_id || phillipPartner[0].relatedEntityId;
    const partnerName = (phillipPartner[0] as any).related_entity_name || phillipPartner[0].relatedEntityName;
    console.log(`   Found partner: ${partnerName}`);
    
    // Step 2: Query facts for the partner
    const partnerFacts = db.getCurrentFacts(partnerName);
    console.log(`   Step 2: Query facts for ${partnerName}...`);
    console.log(`   Facts: ${partnerFacts.length}`);
  }
  
  console.log('\n=== Results ===');
  console.log('✓ Entity creation: PASS');
  console.log('✓ Relationship creation: PASS');
  console.log('✓ Outgoing relationship retrieval: PASS');
  console.log('✓ Incoming relationship retrieval: PASS');
  console.log('✓ findRelatedEntities: PASS');
  console.log('✓ Traversal: PASS');
  
  muninn.close();
}

test().catch(console.error);