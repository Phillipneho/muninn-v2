# TurboQuant Deployment Guide

## Overview

TurboQuant provides 5x compression for Muninn embeddings with ~94% cosine similarity retention. This reduces storage by 74% and enables faster retrieval.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Muninn Cloud                                               │
│                                                             │
│  ┌─────────────────┐    ┌─────────────────────────────┐    │
│  │  API Server     │───▶│  turboquant-server.py      │    │
│  │  (Node.js)      │    │  (persistent Python)         │    │
│  └─────────────────┘    │  - Starts once (15s warmup) │    │
│                         │  - Fast after (~50ms/call)   │    │
│  ┌─────────────────┐    └─────────────────────────────┘    │
│  │  Client Code    │                                      │
│  │  turboquant-    │───▶ compress(embedding) → Buffer      │
│  │  client.ts      │───▶ similarity(query, buf) → number   │
│  └─────────────────┘                                      │
│                                                            │
│  ┌─────────────────┐    ┌─────────────────────────────┐   │
│  │  Supabase       │◀───│  Compressed embeddings      │   │
│  │  (PostgreSQL)   │    │  (BLOB, 74% smaller)        │   │
│  └─────────────────┘    └─────────────────────────────┘   │
│                                                            │
└─────────────────────────────────────────────────────────────┘
```

## Deployment Steps

### 1. Install Dependencies

```bash
# On the server
cd /home/homelab/projects/turboquant_pkg
pip install torch scipy numpy
```

### 2. Start the Server

**Option A: Systemd Service (Recommended)**

```bash
# Create service file
sudo tee /etc/systemd/system/turboquant.service << EOF
[Unit]
Description=TurboQuant Compression Server
After=network.target

[Service]
Type=simple
User=homelab
WorkingDirectory=/home/homelab/projects/muninn/src
ExecStart=/usr/bin/python3 /home/homelab/projects/muninn/src/turboquant-server.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable turboquant
sudo systemctl start turboquant

# Check status
sudo systemctl status turboquant
```

**Option B: PM2 (for Node.js environments)**

```bash
pm2 start src/turboquant-server.py --interpreter python3 --name turboquant
pm2 save
```

**Option C: Docker**

```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN pip install torch scipy numpy
COPY turboquant-server.py .
EXPOSE 8080
CMD ["python", "turboquant-server.py"]
```

### 3. Configure Environment

Add to your `.env` or environment variables:

```bash
# TurboQuant settings
TURBOQUANT_ENABLED=true
TURBOQUANT_BITS=3
TURBOQUANT_SERVER=/home/homelab/projects/muninn/src/turboquant-server.py
```

### 4. Database Migration

```bash
# Run migration
cd /home/homelab/projects/muninn
sqlite3 muninn.db < src/migrations/001_turboquant.sql

# For Supabase/PostgreSQL
psql $DATABASE_URL < src/migrations/001_turboquant.sql
```

### 5. Application Integration

```typescript
import { compress, similarity } from './turboquant-client.js';

// On startup, the client auto-connects to the server

// Store a memory
const embedding = await generateEmbedding(text);
const compressed = await compress(embedding, 3); // 3-bit
await supabase.from('memories').insert({
  content: text,
  embedding: compressed,
  embedding_compressed: true,
  embedding_bits: 3,
});

// Search
const query = await generateEmbedding(queryText);
const results = await supabase.from('memories').select('*');
for (const row of results.data) {
  const score = await similarity(query, row.embedding);
  console.log(row.content, score);
}
```

## Performance

| Metric | FP16 (uncompressed) | TurboQuant (3-bit) |
|--------|---------------------|-------------------|
| Size per embedding | 1,536 bytes | 397 bytes |
| Compression ratio | 1x | 3.9x |
| Storage savings | 0% | 74.2% |
| Cosine similarity | 100% | 94% |
| First call latency | N/A | ~15s (warmup) |
| Subsequent latency | N/A | ~50-100ms |

## Monitoring

```bash
# Check if server is running
echo '{"cmd": "ping"}' | nc localhost <port>

# Check logs
sudo journalctl -u turboquant -f

# Monitor memory
ps aux | grep turboquant
```

## Troubleshooting

### Server won't start

```bash
# Check Python version
python3 --version  # Should be 3.11+

# Check dependencies
python3 -c "import torch; print(torch.__version__)"

# Manual start for debugging
python3 turboquant-server.py
```

### High latency on first call

This is expected. The server loads PyTorch on startup (~15s). Subsequent calls are fast.

### Memory issues

TurboQuant uses ~500MB RAM for the PyTorch runtime. Ensure your server has at least 1GB free.

## Scaling

For high-traffic deployments:

1. **Multiple instances** — Run multiple server processes behind a load balancer
2. **GPU acceleration** — PyTorch supports CUDA for faster compression
3. **Batch processing** — Compress multiple embeddings in one call

## Security

- The server communicates via stdin/stdout (no network exposure)
- No authentication needed for local process communication
- For remote access, add authentication in the Python server

---

**Files:**
- `turboquant-server.py` — Persistent Python server
- `turboquant-client.ts` — TypeScript client
- `turboquant-simple.ts` — One-shot compression (slower)
- `migrations/001_turboquant.sql` — Database schema
- `embeddings-unified.ts` — Integration with Muninn

**Last updated:** 2026-03-26