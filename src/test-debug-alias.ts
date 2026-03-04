// Debug alias resolution
import { Muninn } from './index.js';
import { existsSync, unlinkSync } from 'fs';

const dbPath = '/tmp/test-debug-alias.db';
if (existsSync(dbPath)) unlinkSync(dbPath);

const muninn = new Muninn(dbPath);

const db = muninn['db'];

// Create entity
const alisha = db.createEntity({ name: 'Alisha', type: 'person' });
console.log('Entity:', alisha);

// Add alias
db.addAlias(alisha.id, 'Lish', 'user', 1.0);
console.log('Alias added');

// Check raw table
const rawAliases = db['db'].prepare('SELECT * FROM entity_aliases').all();
console.log('Raw aliases:', rawAliases);

// Try resolveEntity
const resolved = db.resolveEntity('Lish');
console.log('resolveEntity("Lish"):', resolved);

// Try findEntityByAlias
const byAlias = db.findEntityByAlias('Lish');
console.log('findEntityByAlias("Lish"):', byAlias);

muninn.close();