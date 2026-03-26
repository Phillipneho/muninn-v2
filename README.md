# Muninn v5.3

**Memory as evolving reality, not stored text.**

A bi-temporal knowledge graph for AI agents with Supermemory parity. Extracts atomic facts, tracks state changes, builds profiles, and answers queries without replaying conversation history.

## Why Muninn v5.3?

| Feature | Current Memory Systems | Muninn v5.3 |
|---------|----------------------|-------------|
| **Storage** | Conversations (300+ turns) | Atomic facts + TurboQuant compression |
| **Retrieval** | Vector search (high noise) | Structured → Graph → Semantic |
| **Temporal** | Metadata only | Bi-temporal (T + T') |
| **Contradictions** | Overwrite or ignore | Preserve both sides |
| **Token cost** | O(n) as history grows | O(log n) with profiles |
| **Compression** | None | 5x with TurboQuant (94% similarity) |
| **Profiles** | Raw memories (5000+ tokens) | Distilled facts (100-200 tokens) |
| **Forgetting** | Manual only | Auto-expire temporal facts |

**Result:** 96% token reduction (5,000 → 200 tokens per query)

## Architecture

### Core Tables

| Table | Purpose |
|-------|---------|
| `episodes` | Raw source data (non-lossy) |
| `entities` | Named nodes in knowledge graph |
| `facts` | Bi-temporal assertions with memory types |
| `events` | State transitions |
| `relationships` | Directed, typed links |
| `contradictions` | Conflict preservation |
| `profiles` | Cached static/dynamic facts |
| `memory_history` | Track fact evolution |

### Memory Types

| Type | Behavior | Example |
|------|----------|---------|
| **fact** | Persists until updated | "Phillip founded Elev8Advisory" |
| **preference** | Strengthens with repetition | "Phillip prefers Australian spelling" |
| **episode** | Decays over time | "Met Alex for coffee yesterday" |

### Retrieval Priority

```
Query → Extract entities → 
  1. Query structured state (facts)
  2. Traverse knowledge graph
  3. Reason over events (temporal)
  4. Fall back to semantic search
→ Return context within token budget
```

## What's New in v5.3

### Profile Abstraction (Supermemory Parity)

```typescript
// Before: 5000+ tokens of raw memories
const memories = await memory.recall('What does Phillip prefer?');

// After: 100-200 tokens of distilled facts
const profile = await memory.profile({ maxStaticFacts: 10 });
// → {
//     static: ["Phillip founded Elev8Advisory", "Phillip prefers Australian spelling"],
//     dynamic: ["Working on Muninn Supermemory integration"],
//     tokenCount: 87
//   }
```

### Auto-Forgetting

```typescript
// Temporal facts auto-expire
await memory.remember("I have an exam tomorrow", { 
  autoExpire: true  // Detects temporal expression, sets expiry
});

// Sleep cycle runs forgetting
const result = await memory.sleepCycle();
// → { expired: 5, decayed: 12, totalForgotten: 17 }
```

### Token Budget Retrieval

```typescript
// Budget-aware retrieval
const result = await memory.recall('What does Phillip prefer?', {
  maxTokens: 500,  // Returns only what fits
  includeProfile: true
});
// → { profile, memories, tokensUsed: 387, tokensRemaining: 113 }
```

### TurboQuant Compression

```typescript
// 5x storage reduction, 94% similarity
import { compress, similarity } from './turboquant-client.js';

const compressed = await compress(embedding, 3);  // 3-bit quantization
const score = await similarity(query, compressed);  // Direct inner product
```

## Quick Start

### Local SQLite

```bash
# Install dependencies
npm install

# Create tables
sqlite3 muninn.db < src/schema-sqlite.sql

# Run migration
sqlite3 muninn.db < src/migrations/002_profile_forgetting.sql

# Run tests
npx tsx src/test-supermemory-integration.ts
```

### Cloud (Supabase)

```bash
# Configure for Supabase
DATABASE_URL='postgresql://...' npm run migrate

# Or use Muninn Cloud API
curl -X POST https://api.muninn.au/remember \
  -H "Authorization: Bearer $MUNINN_API_KEY" \
  -d '{"content": "..."}'
```

## Usage

### MCP Server (Claude/Agents)

```json
{
  "name": "memory_profile",
  "description": "Get static/dynamic profile. Fast (~50ms) for system prompt injection.",
  "inputSchema": {
    "maxStaticFacts": 10,
    "maxDynamicFacts": 5
  }
}
```

```json
{
  "name": "memory_briefing",
  "description": "Budget-aware session briefing.",
  "inputSchema": {
    "context": "session start",
    "maxTokens": 500
  }
}
```

```json
{
  "name": "memory_forget",
  "description": "Trigger forgetting cycle or list expiring facts.",
  "inputSchema": {
    "action": "expire" | "decay" | "list"
  }
}
```

### Programmatic

```typescript
import { Muninn } from 'muninn-v2';

const memory = new Muninn(process.env.DATABASE_URL);

// Remember with auto-classification
await memory.remember(`
  I went to the LGBTQ support group yesterday. 
  It was really helpful - I'm going to keep attending.
`, {
  source: 'conversation',
  actor: 'Caroline',
  sessionDate: '2023-05-07',
  autoExpire: false  // Set true for temporal facts
});
// → Creates:
//   - Entity: Caroline (person), LGBTQ support group (org)
//   - Fact: Caroline → attends → LGBTQ support group (type: episode)
//   - Event: Caroline.attendance = "LGBTQ support group"

// Get profile (distilled facts)
const profile = await memory.profile();
// → { static: [...], dynamic: [...], tokenCount: 87 }

// Query with token budget
const result = await memory.recall('What does Caroline attend?', { 
  maxTokens: 200 
});

// Track changes over time
const evolution = await memory.getEvolution('Caroline');

// Traverse knowledge graph
const path = await memory.traverseGraph('Caroline', 3);

// Get unresolved contradictions
const conflicts = await memory.getContradictions();
```

## Sleep Cycle

Runs at 2:00 AM to:

1. **Consolidate** — Compress 24 hours of observations into prototypes
2. **Forget** — Remove expired facts, decay old episodes
3. **Strengthen** — Boost preference confidence with repetition

```typescript
// Run manually
const result = await memory.sleepCycle();
// → { entitiesProcessed: 42, prototypesCreated: 8, forgotten: 17 }
```

## Bi-Temporal Model

Every fact has two time dimensions:

| Timestamp | Meaning |
|-----------|---------|
| `valid_from` | When it became true in the world |
| `valid_until` | When it stopped being true |
| `created_at` | When the system learned it |
| `invalidated_at` | When the system learned it was wrong |
| `expires_at` | When it should be forgotten (temporal facts) |

## Compression (TurboQuant)

| Dimension | FP16 | TurboQuant (3-bit) | Savings |
|-----------|------|-------------------|---------|
| 768 | 1,536 bytes | 397 bytes | 74% |
| 1536 | 3,072 bytes | 789 bytes | 74% |

**Similarity retention:** 94% cosine similarity at 3-bit quantization

## Comparison to Alternatives

| Feature | Mem0 | Zep | Supermemory | Muninn v5.3 |
|---------|------|-----|--------------|--------------|
| **Storage** | Triplets | Episodes + Facts | Graph memory | Facts + Events |
| **Temporal** | `valid_at`/`invalid_at` | Bi-temporal | Bi-temporal | Bi-temporal |
| **Contradictions** | Marks invalid | Edge invalidation | Auto-resolve | **Preserves both** |
| **Retrieval** | Vector + Graph | Vector + Graph | Profile-first | **Structured first** |
| **Profiles** | ❌ | ❌ | ✅ Static + Dynamic | ✅ Static + Dynamic |
| **Auto-forget** | ❌ | ❌ | ✅ | ✅ |
| **Compression** | ❌ | ❌ | ❌ | ✅ TurboQuant |
| **Self-hosted** | ❌ | ❌ | ❌ | ✅ Free local |
| **Database** | Qdrant/Neo4j | PostgreSQL | Cloud only | SQLite/PostgreSQL |

## API Reference

### Core Operations

| Method | Description |
|--------|-------------|
| `remember(content, options)` | Store with auto-extraction |
| `recall(query, options)` | Retrieve with budget |
| `profile(options)` | Get distilled facts |
| `forget(action)` | Trigger forgetting cycle |

### Knowledge Graph

| Method | Description |
|--------|-------------|
| `getEvolution(entity, from?, to?)` | State changes over time |
| `traverseGraph(entity, maxDepth?)` | Multi-hop relationships |
| `getContradictions()` | Unresolved conflicts |

### Sleep Cycle

| Method | Description |
|--------|-------------|
| `sleepCycle()` | Consolidate + forget |

## License

MIT

## Credits

- **Inspiration:** [Zep](https://github.com/getzep/zep) — Bi-temporal knowledge graph
- **Supermemory** — Profile abstraction, auto-forgetting
- **TurboQuant** — Vector compression (Google Research, ICLR 2026)
- **Architecture:** SQLite/PostgreSQL + pgvector for structured + semantic retrieval
- **Built for:** AI agents that need persistent, queryable memory