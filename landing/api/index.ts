import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import crypto from 'crypto';

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

// Service client (bypasses RLS for internal operations)
const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ============================================
// AUTH MIDDLEWARE
// ============================================

interface AuthContext {
  organizationId: string;
  userId?: string;
  authMethod: 'api_key' | 'supabase_auth';
  tier: 'free' | 'pro' | 'enterprise';
}

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function authenticate(req: VercelRequest): Promise<AuthContext> {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing authorization header');
  }
  
  const token = authHeader.slice(7);
  
  if (token.startsWith('eyJ')) {
    return authenticateWithJwt(token);
  } else if (token.startsWith('muninn_')) {
    return authenticateWithApiKey(token);
  }
  
  throw new Error('Invalid token format');
}

async function authenticateWithJwt(jwt: string): Promise<AuthContext> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }
  });
  
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error || !user) {
    throw new Error('Invalid or expired token');
  }
  
  const { data: role } = await supabaseService
    .from('user_roles')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .single();
  
  if (!role) {
    throw new Error('User not associated with any organization');
  }
  
  const { data: org } = await supabaseService
    .from('organizations')
    .select('tier')
    .eq('id', role.organization_id)
    .single();
  
  return {
    organizationId: role.organization_id,
    userId: user.id,
    authMethod: 'supabase_auth',
    tier: (org?.tier as 'free' | 'pro' | 'enterprise') || 'free'
  };
}

async function authenticateWithApiKey(apiKey: string): Promise<AuthContext> {
  const keyHash = hashKey(apiKey);
  
  const { data: key, error } = await supabaseService
    .from('api_keys')
    .select('id, organization_id, tier, usage_count, usage_limit, active')
    .eq('key_hash', keyHash)
    .eq('active', true)
    .single();
  
  if (error || !key) {
    throw new Error('Invalid or revoked API key');
  }
  
  if (key.usage_count >= key.usage_limit) {
    throw new Error('Usage limit exceeded');
  }
  
  await supabaseService
    .from('api_keys')
    .update({ usage_count: key.usage_count + 1, last_used_at: new Date().toISOString() })
    .eq('id', key.id);
  
  return {
    organizationId: key.organization_id,
    authMethod: 'api_key',
    tier: key.tier as 'free' | 'pro' | 'enterprise'
  };
}

// ============================================
// BYOK ENCRYPTION (for provider_configs)
// ============================================

function encryptApiKey(text: string): string {
  const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
  if (!ENCRYPTION_KEY) {
    // Fallback: store plaintext if no encryption key (dev mode)
    console.warn('No ENCRYPTION_KEY set - storing API keys in plaintext');
    return 'plaintext:' + text;
  }
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptApiKey(encrypted: string): string {
  const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
  
  // Handle plaintext fallback
  if (encrypted.startsWith('plaintext:')) {
    return encrypted.slice(10);
  }
  
  if (!ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY required for decryption');
  }
  
  const [ivHex, data] = encrypted.split(':');
  if (!ivHex || !data) {
    throw new Error('Invalid encrypted key format');
  }
  
  const iv = Buffer.from(ivHex, 'hex');
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ============================================
// ORGANIZATION PROVIDER CONFIG (BYOK)
// ============================================

interface ProviderConfig {
  provider: 'openai' | 'gemini' | 'anthropic' | 'ollama' | 'openrouter';
  apiKey: string;
  baseUrl?: string;
  model: string;
}

const PROVIDER_DEFAULTS: Record<string, { model: string; baseUrl?: string }> = {
  openai: { model: 'text-embedding-3-small' },
  gemini: { model: 'gemini-embedding-001' },
  anthropic: { model: 'claude-3-sonnet-20240229' },
  ollama: { model: 'nomic-embed-text', baseUrl: 'http://localhost:11434' },
  openrouter: { model: 'openai/text-embedding-3-small', baseUrl: 'https://openrouter.ai/api/v1' }
};

async function getOrgProviderConfig(orgId: string): Promise<ProviderConfig | null> {
  try {
    const { data, error } = await supabaseService
      .from('provider_configs')
      .select('provider, api_key_encrypted, base_url, model')
      .eq('organization_id', orgId)
      .single();
    
    if (error || !data) {
      return null;
    }
    
    const defaults = PROVIDER_DEFAULTS[data.provider] || { model: 'text-embedding-3-small' };
    
    return {
      provider: data.provider,
      apiKey: data.api_key_encrypted ? decryptApiKey(data.api_key_encrypted) : '',
      baseUrl: data.base_url || defaults.baseUrl,
      model: data.model || defaults.model
    };
  } catch {
    return null;
  }
}

// ============================================
// EMBEDDING GENERATION (BYOK-aware)
// ============================================

async function generateEmbedding(text: string, orgConfig?: ProviderConfig | null): Promise<{ embedding: number[] | null; error?: string; model?: string }> {
  // Priority: 1) Org BYOK config, 2) Global env vars
  const provider = orgConfig?.provider || process.env.EMBEDDING_MODE || 'gemini';
  const model = orgConfig?.model;
  
  if (provider === 'gemini') {
    const apiKey = orgConfig?.apiKey || process.env.GEMINI_API_KEY;
    if (apiKey) {
      const result = await generateGeminiEmbedding(text, apiKey, model);
      return { embedding: result.embedding, error: result.error, model: result.model };
    }
    // Fallback to OpenAI if Gemini key not available
    const openaiResult = await generateOpenAIEmbedding(text, orgConfig?.apiKey);
    return { embedding: openaiResult, error: openaiResult ? undefined : 'No Gemini key and no OpenAI fallback' };
  }
  
  if (provider === 'openai') {
    const apiKey = orgConfig?.apiKey || process.env.OPENAI_API_KEY;
    const result = await generateOpenAIEmbedding(text, apiKey);
    return { embedding: result, error: result ? undefined : 'No OpenAI key available' };
  }
  
  if (provider === 'openrouter') {
    const apiKey = orgConfig?.apiKey || process.env.OPENROUTER_API_KEY;
    const result = await generateOpenRouterEmbedding(text, apiKey, orgConfig?.baseUrl);
    return { embedding: result, error: result ? undefined : 'No OpenRouter key available' };
  }
  
  // Default fallback to Gemini
  const apiKey = orgConfig?.apiKey || process.env.GEMINI_API_KEY;
  if (apiKey) {
    const result = await generateGeminiEmbedding(text, apiKey, model);
    return { embedding: result.embedding, error: result.error, model: result.model };
  }
  
  const openaiResult = await generateOpenAIEmbedding(text, orgConfig?.apiKey);
  return { embedding: openaiResult, error: openaiResult ? undefined : 'No embedding keys available' };
}

async function generateGeminiEmbedding(text: string, apiKey?: string, model?: string): Promise<{ embedding: number[] | null; error?: string; model?: string }> {
  if (!apiKey) {
    return { embedding: null, error: 'No API key provided' };
  }
  
  // Use configured model or default to gemini-embedding-001
  const modelName = model || 'gemini-embedding-001';
  
  // Gemini embedding models produce 3072 dims by default
  // Use outputDimensionality to match our database (768 dims)
  const targetDimension = 768;
  
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:embedContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${modelName}`,
          content: { parts: [{ text: text.slice(0, 30000) }] },
          outputDimensionality: targetDimension
        })
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      return { embedding: null, error: `Gemini ${response.status}: ${errorText.substring(0, 200)}`, model: modelName };
    }
    
    const data = await response.json();
    if (!data.embedding?.values) {
      return { embedding: null, error: 'No embedding in response', model: modelName };
    }
    return { embedding: data.embedding.values, model: modelName };
  } catch (error: any) {
    return { embedding: null, error: `Exception: ${error.message}`, model: modelName };
  }
}

async function generateOpenAIEmbedding(text: string, apiKey?: string): Promise<number[] | null> {
  const key = apiKey || process.env.OPENAI_API_KEY;
  
  if (!key) {
    return null;
  }
  
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000)
      })
    });
    
    if (!response.ok) {
      console.error('OpenAI embedding error:', response.status);
      return null;
    }
    
    const data = await response.json();
    return data.data?.[0]?.embedding || null;
  } catch (error) {
    console.error('OpenAI embedding error:', error);
    return null;
  }
}

async function generateOpenRouterEmbedding(text: string, apiKey?: string, baseUrl?: string): Promise<number[] | null> {
  if (!apiKey) {
    return null;
  }
  
  const url = baseUrl || 'https://openrouter.ai/api/v1';
  
  try {
    const response = await fetch(`${url}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/text-embedding-3-small',
        input: text.slice(0, 8000)
      })
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    return data.data?.[0]?.embedding || null;
  } catch {
    return null;
  }
}

// ============================================
// API HANDLERS
// ============================================

async function handleHealth(req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    status: 'ok',
    service: 'muninn-cloud',
    version: '2.0.0',
    auth_methods: ['api_key', 'supabase_auth'],
    features: ['semantic_search', 'organization_isolation', 'audit_logging'],
    supabase: SUPABASE_URL ? 'connected' : 'not_configured'
  });
}

async function handleCreateOrganization(req: VercelRequest, res: VercelResponse) {
  try {
    const { name, email, tier = 'free' } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email required' });
    }
    
    const { data: org, error: orgError } = await supabaseService
      .from('organizations')
      .insert({ name, tier })
      .select()
      .single();
    
    if (orgError) {
      return res.status(500).json({ error: 'Failed to create organization' });
    }
    
    const apiKey = 'muninn_live_' + crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    const keyHash = hashKey(apiKey);
    const keyPrefix = apiKey.slice(0, 12);
    
    const { error: keyError } = await supabaseService
      .from('api_keys')
      .insert({
        organization_id: org.id,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        tier,
        usage_limit: tier === 'free' ? 1000 : tier === 'pro' ? 50000 : 1000000
      });
    
    if (keyError) {
      await supabaseService.from('organizations').delete().eq('id', org.id);
      return res.status(500).json({ error: 'Failed to create API key' });
    }
    
    res.status(201).json({
      organization: org,
      api_key: apiKey,
      message: 'Store this API key securely. It will not be shown again.'
    });
  } catch (error) {
    console.error('Organization creation error:', error);
    res.status(500).json({ error: 'Failed to create organization' });
  }
}

async function handleStoreMemory(req: VercelRequest, res: VercelResponse) {
  const debugInfo: any = {};
  
  try {
    const auth = await authenticate(req);
    const body = req.body;
    
    // Get org's BYOK config
    const orgConfig = await getOrgProviderConfig(auth.organizationId);
    
    // Check env vars as fallback
    const geminiKey = orgConfig?.apiKey || process.env.GEMINI_API_KEY;
    
    // Debug info
    debugInfo.orgProvider = orgConfig?.provider;
    debugInfo.orgHasApiKey = !!orgConfig?.apiKey;
    debugInfo.orgModel = orgConfig?.model;
    debugInfo.keySource = orgConfig?.apiKey ? 'BYOK' : 'ENV';
    debugInfo.keyLen = geminiKey?.length;
    
    const embeddingResult = await generateEmbedding(body.content, orgConfig);
    const embedding = embeddingResult.embedding;
    
    debugInfo.embeddingLen = embedding?.length;
    debugInfo.embeddingModel = embeddingResult.model;
    debugInfo.embeddingError = embeddingResult.error;
    
    const { data, error } = await supabaseService
      .from('memories')
      .insert({
        organization_id: auth.organizationId,
        user_id: auth.userId || null,
        content: body.content,
        type: body.type || 'semantic',
        metadata: body.metadata || {},
        entities: body.entities || [],
        embedding,
        salience: body.salience || 0.5,
        visibility: body.visibility || 'organization',
        source_type: body.source_type || 'user_input'
      })
      .select('id, content, type, metadata, entities, salience, visibility, created_at')
      .single();
    
    if (error) {
      console.error('Insert error:', error);
      return res.status(500).json({ error: 'Failed to store memory' });
    }
    
    res.status(201).json({
      ...data,
      embedding_generated: embedding !== null,
      provider: orgConfig?.provider || 'default',
      debug: debugInfo
    });
  } catch (error: any) {
    if (error.message?.includes('authorization')) {
      return res.status(401).json({ error: error.message, debug: debugInfo });
    }
    console.error('Store error:', error);
    res.status(500).json({ error: 'Failed to store memory', debug: debugInfo, errorMessage: error.message });
  }
}

async function handleSearchMemories(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await authenticate(req);
    const { q, limit = 10, type, threshold = 0.3 } = req.query as any;
    
    if (!q) {
      return res.status(400).json({ error: 'Missing query parameter "q"' });
    }
    
    // Get org's BYOK config
    const orgConfig = await getOrgProviderConfig(auth.organizationId);
    
    const embeddingResult = await generateEmbedding(q, orgConfig);
    const queryEmbedding = embeddingResult.embedding;
    let results: any[] = [];
    
    if (queryEmbedding) {
      const { data, error } = await supabaseService.rpc('search_memories', {
        query_embedding: queryEmbedding,
        org_id: auth.organizationId,
        match_threshold: parseFloat(threshold),
        match_count: parseInt(limit),
        filter_type: type || null
      });
      
      if (!error && data) {
        results = data;
      }
    }
    
    if (results.length === 0) {
      let queryBuilder = supabaseService
        .from('memories')
        .select('id, content, type, metadata, entities, salience, created_at')
        .eq('organization_id', auth.organizationId)
        .ilike('content', `%${q}%`);
      
      if (type) {
        queryBuilder = queryBuilder.eq('type', type);
      }
      
      const { data, error } = await queryBuilder.limit(parseInt(limit));
      
      if (!error && data) {
        results = data;
      }
    }
    
    res.json({
      results,
      count: results.length,
      query: q,
      search_type: queryEmbedding ? 'semantic' : 'keyword',
      provider: orgConfig?.provider || 'default'
    });
  } catch (error: any) {
    if (error.message?.includes('authorization')) {
      return res.status(401).json({ error: error.message });
    }
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to search memories' });
  }
}

async function handleGetMemory(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await authenticate(req);
    const { id } = req.query;
    
    const { data, error } = await supabaseService
      .from('memories')
      .select('id, content, type, metadata, entities, salience, visibility, created_at')
      .eq('id', id)
      .eq('organization_id', auth.organizationId)
      .single();
    
    if (error || !data) {
      return res.status(404).json({ error: 'Memory not found' });
    }
    
    res.json(data);
  } catch (error: any) {
    if (error.message?.includes('authorization')) {
      return res.status(401).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to get memory' });
  }
}

async function handleDeleteMemory(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await authenticate(req);
    const { id } = req.query;
    
    const { data: memory, error: fetchError } = await supabaseService
      .from('memories')
      .select('id')
      .eq('id', id)
      .eq('organization_id', auth.organizationId)
      .single();
    
    if (fetchError || !memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }
    
    const { error } = await supabaseService
      .from('memories')
      .delete()
      .eq('id', id);
    
    if (error) {
      return res.status(500).json({ error: 'Failed to delete memory' });
    }
    
    res.json({ deleted: true, id });
  } catch (error: any) {
    if (error.message?.includes('authorization')) {
      return res.status(401).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to delete memory' });
  }
}

async function handleUpdateMemory(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await authenticate(req);
    const { id } = req.query;
    const { content, metadata, salience } = req.body;
    
    // Verify ownership
    const { data: existing, error: fetchError } = await supabaseService
      .from('memories')
      .select('id, content, metadata, salience')
      .eq('id', id)
      .eq('organization_id', auth.organizationId)
      .single();
    
    if (fetchError || !existing) {
      return res.status(404).json({ error: 'Memory not found' });
    }
    
    // Update
    const updates: any = { updated_at: new Date().toISOString() };
    if (content !== undefined) updates.content = content;
    if (metadata !== undefined) updates.metadata = { ...existing.metadata, ...metadata };
    if (salience !== undefined) updates.salience = salience;
    
    const { data, error } = await supabaseService
      .from('memories')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      return res.status(500).json({ error: 'Failed to update memory' });
    }
    
    // Log audit
    if (auth.userId) {
      await supabaseService
        .from('memory_audit_log')
        .insert({
          memory_id: id,
          action: 'edit',
          old_value: existing,
          new_value: data,
          changed_by: auth.userId
        });
    }
    
    res.json(data);
  } catch (error: any) {
    if (error.message?.includes('authorization')) {
      return res.status(401).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to update memory' });
  }
}

async function handleListMemories(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await authenticate(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const dateFrom = req.query.date_from as string;
    const dateTo = req.query.date_to as string;
    
    let query = supabaseService
      .from('memories')
      .select('id, content, metadata, salience, created_at, updated_at, entities', { count: 'exact' })
      .eq('organization_id', auth.organizationId)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    
    if (search) {
      query = query.ilike('content', `%${search}%`);
    }
    if (dateFrom) {
      query = query.gte('created_at', dateFrom);
    }
    if (dateTo) {
      query = query.lte('created_at', dateTo);
    }
    
    const { data: memories, error, count } = await query;
    
    if (error) {
      console.error('Error fetching memories:', error);
      return res.status(500).json({ error: 'Failed to fetch memories' });
    }
    
    res.json({
      memories,
      total: count,
      page,
      limit,
      total_pages: Math.ceil((count || 0) / limit)
    });
  } catch (error: any) {
    if (error.message?.includes('authorization')) {
      return res.status(401).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to list memories' });
  }
}

async function handleAnalytics(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await authenticate(req);
    
    // Get total memories
    const { count: totalMemories } = await supabaseService
      .from('memories')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', auth.organizationId);
    
    // Get average salience
    const { data: memories } = await supabaseService
      .from('memories')
      .select('salience')
      .eq('organization_id', auth.organizationId);
    
    const avgSalience = memories && memories.length > 0
      ? memories.reduce((sum, m) => sum + (m.salience || 0.5), 0) / memories.length
      : 0.5;
    
    // Get growth data (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { data: growthData } = await supabaseService
      .from('memories')
      .select('created_at')
      .eq('organization_id', auth.organizationId)
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: true });
    
    // Group by day
    const growthByDay: Record<string, number> = {};
    (growthData || []).forEach(m => {
      const day = m.created_at.split('T')[0];
      growthByDay[day] = (growthByDay[day] || 0) + 1;
    });
    
    // Calculate growth rate
    const days = Object.keys(growthByDay).sort();
    const last7Days = days.slice(-7).reduce((sum, d) => sum + growthByDay[d], 0);
    const prev7Days = days.slice(-14, -7).reduce((sum, d) => sum + growthByDay[d], 0);
    const growthRate = prev7Days > 0 ? Math.round(((last7Days - prev7Days) / prev7Days) * 100) : 0;
    
    // Get top entities from metadata
    const { data: memoryMetadata } = await supabaseService
      .from('memories')
      .select('metadata')
      .eq('organization_id', auth.organizationId)
      .limit(100);
    
    const entityCounts: Record<string, number> = {};
    (memoryMetadata || []).forEach(m => {
      const entities = m.metadata?.entities || [];
      entities.forEach((e: string) => {
        entityCounts[e] = (entityCounts[e] || 0) + 1;
      });
    });
    
    const topEntities = Object.entries(entityCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
    
    // Salience distribution
    const salienceDistribution = {
      '0.0-0.2': 0,
      '0.2-0.4': 0,
      '0.4-0.6': 0,
      '0.6-0.8': 0,
      '0.8-1.0': 0
    };
    
    (memories || []).forEach(m => {
      const s = m.salience || 0.5;
      if (s < 0.2) salienceDistribution['0.0-0.2']++;
      else if (s < 0.4) salienceDistribution['0.2-0.4']++;
      else if (s < 0.6) salienceDistribution['0.4-0.6']++;
      else if (s < 0.8) salienceDistribution['0.6-0.8']++;
      else salienceDistribution['0.8-1.0']++;
    });
    
    res.json({
      total_memories: totalMemories || 0,
      total_retrievals: 0, // Will track when we add access logging
      avg_salience: Math.round(avgSalience * 100) / 100,
      growth_rate: growthRate,
      growth_data: days.slice(-30).map(d => ({ date: d, count: growthByDay[d] })),
      top_entities: topEntities,
      salience_distribution: salienceDistribution
    });
  } catch (error: any) {
    if (error.message?.includes('authorization')) {
      return res.status(401).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to get analytics' });
  }
}

// ============================================
// AUDIT HANDLER
// ============================================

async function handleAudit(req: VercelRequest, res: VercelResponse, ctx: AuthContext) {
  const action = req.query.action as string;
  
  switch (action) {
    case 'audit:health':
    case 'health':
      return getAuditHealth(ctx, res);
    case 'audit:contradictions':
    case 'contradictions':
      return getAuditContradictions(ctx, req, res);
    case 'audit:access':
    case 'access':
      return getAuditAccess(ctx, req, res);
    case 'audit:staleness':
    case 'staleness':
      return getAuditStaleness(ctx, req, res);
    case 'audit:integrity':
    case 'integrity':
      return getAuditIntegrity(ctx, res);
    default:
      return res.status(400).json({ success: false, error: 'Invalid audit action. Use: health, contradictions, access, staleness, integrity' });
  }
}

async function getAuditHealth(ctx: AuthContext, res: VercelResponse) {
  try {
    // Get memory counts
    const { count: totalMemories } = await supabaseService
      .from('memories')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', ctx.organizationId);
    
    // Get integrity stats (if table exists)
    const { data: integrityStats } = await supabaseService
      .from('memory_integrity')
      .select('status')
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();
    
    const verified = integrityStats?.verified || 0;
    const flagged = integrityStats?.flagged || 0;
    
    // Get staleness stats (if table exists)
    const { data: staleStats } = await supabaseService
      .from('staleness_tracker')
      .select('status')
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();
    
    const stale = staleStats?.stale || 0;
    
    // Calculate health score
    const healthScore = totalMemories && totalMemories > 0 
      ? Math.round(((totalMemories - stale - flagged) / totalMemories) * 100) 
      : 100;
    
    return res.json({
      success: true,
      healthScore,
      total: totalMemories || 0,
      verified,
      stale,
      flagged,
      fresh: (totalMemories || 0) - stale
    });
  } catch (error) {
    // Return defaults if tables don't exist yet
    return res.json({
      success: true,
      healthScore: 100,
      total: 0,
      verified: 0,
      stale: 0,
      flagged: 0,
      fresh: 0
    });
  }
}

async function getAuditContradictions(ctx: AuthContext, req: VercelRequest, res: VercelResponse) {
  const status = req.query.status as string || 'unresolved';
  const limit = parseInt(req.query.limit as string) || 50;
  
  try {
    let query = supabaseService
      .from('contradiction_flags')
      .select('*')
      .eq('organization_id', ctx.organizationId)
      .order('confidence', { ascending: false })
      .limit(limit);
    
    if (status !== 'all') {
      query = query.eq('status', status);
    }
    
    const { data: contradictions, error } = await query;
    
    if (error) {
      // Table might not exist
      return res.json({ success: true, contradictions: [], count: 0 });
    }
    
    return res.json({
      success: true,
      contradictions: contradictions || [],
      count: contradictions?.length || 0
    });
  } catch (error) {
    return res.json({ success: true, contradictions: [], count: 0 });
  }
}

async function getAuditAccess(ctx: AuthContext, req: VercelRequest, res: VercelResponse) {
  const timeRangeHours = parseInt(req.query.timeRangeHours as string) || 24;
  
  try {
    // Get recent audit events (if table exists)
    const { data: events } = await supabaseService
      .from('audit_events')
      .select('*')
      .eq('organization_id', ctx.organizationId)
      .gte('created_at', new Date(Date.now() - timeRangeHours * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false });
    
    // Calculate top memories
    const memoryCounts: Record<string, number> = {};
    const agentCounts: Record<string, number> = {};
    const retrievalTypes: Record<string, number> = { semantic: 0, keyword: 0, temporal: 0 };
    
    (events || []).forEach((event: any) => {
      if (event.memory_id) {
        memoryCounts[event.memory_id] = (memoryCounts[event.memory_id] || 0) + 1;
      }
      if (event.actor_id) {
        agentCounts[event.actor_id] = (agentCounts[event.actor_id] || 0) + 1;
      }
      if (event.retrieval_type) {
        retrievalTypes[event.retrieval_type] = (retrievalTypes[event.retrieval_type] || 0) + 1;
      }
    });
    
    const topMemories = Object.entries(memoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => ({ id, count }));
    
    const topAgents = Object.entries(agentCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ id, count }));
    
    const totalQueries = (events || []).filter((e: any) => e.operation === 'recall').length;
    const successRate = totalQueries > 0 
      ? (events || []).filter((e: any) => e.success).length / totalQueries 
      : 1;
    
    return res.json({
      success: true,
      topMemories,
      topAgents,
      retrievalDistribution: retrievalTypes,
      metrics: {
        totalQueries,
        avgLatencyMs: 0,
        successRate
      }
    });
  } catch (error) {
    return res.json({
      success: true,
      topMemories: [],
      topAgents: [],
      retrievalDistribution: { semantic: 0, keyword: 0, temporal: 0 },
      metrics: { totalQueries: 0, avgLatencyMs: 0, successRate: 1 }
    });
  }
}

async function getAuditStaleness(ctx: AuthContext, req: VercelRequest, res: VercelResponse) {
  try {
    // Get staleness data
    const { data: staleData } = await supabaseService
      .from('staleness_tracker')
      .select('*')
      .eq('organization_id', ctx.organizationId)
      .order('last_updated', { ascending: false });
    
    // Build timeline (last 30 days)
    const timeline = [];
    for (let i = 30; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      timeline.push({
        date: dateStr,
        freshness: Math.max(70, 100 - i * 0.5)
      });
    }
    
    // Group by entity
    const entityStaleness: Record<string, { total: number; stale: number }> = {};
    (staleData || []).forEach((s: any) => {
      if (!entityStaleness[s.entity]) {
        entityStaleness[s.entity] = { total: 0, stale: 0 };
      }
      entityStaleness[s.entity].total++;
      if (s.status === 'stale') {
        entityStaleness[s.entity].stale++;
      }
    });
    
    return res.json({
      success: true,
      freshnessTimeline: timeline,
      entityStaleness: Object.entries(entityStaleness).map(([entity, data]) => ({
        entity,
        total: data.total,
        stale: data.stale,
        freshPercent: Math.round(((data.total - data.stale) / data.total) * 100)
      })),
      stats: {
        total: staleData?.length || 0,
        fresh: (staleData || []).filter((s: any) => s.status === 'fresh').length,
        stale: (staleData || []).filter((s: any) => s.status === 'stale').length,
        veryStale: (staleData || []).filter((s: any) => s.status === 'very_stale').length
      }
    });
  } catch (error) {
    // Return placeholder if tables don't exist
    const timeline = [];
    for (let i = 30; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      timeline.push({ date: dateStr, freshness: 100 });
    }
    
    return res.json({
      success: true,
      freshnessTimeline: timeline,
      entityStaleness: [],
      stats: { total: 0, fresh: 0, stale: 0, veryStale: 0 }
    });
  }
}

async function getAuditIntegrity(ctx: AuthContext, res: VercelResponse) {
  try {
    const { data: integrity } = await supabaseService
      .from('memory_integrity')
      .select('*')
      .eq('organization_id', ctx.organizationId);
    
    return res.json({
      success: true,
      records: integrity || [],
      stats: {
        total: integrity?.length || 0,
        verified: (integrity || []).filter((i: any) => i.status === 'verified').length,
        unverified: (integrity || []).filter((i: any) => i.status === 'unverified').length,
        flagged: (integrity || []).filter((i: any) => i.status === 'flagged').length
      }
    });
  } catch (error) {
    return res.json({
      success: true,
      records: [],
      stats: { total: 0, verified: 0, unverified: 0, flagged: 0 }
    });
  }
}

// ============================================
// MAIN HANDLER
// ============================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Strip /api prefix from path for routing
  let path = req.url?.split('?')[0] || '/';
  if (path.startsWith('/api')) {
    path = path.slice(4) || '/';
  }
  
  try {
    // Health check (no auth)
    if (req.method === 'GET' && path === '/health') {
      return handleHealth(req, res);
    }
    
    // Create organization (no auth)
    if (req.method === 'POST' && path === '/organizations') {
      return handleCreateOrganization(req, res);
    }
    
    // Analytics
    if (req.method === 'GET' && path === '/analytics') {
      return handleAnalytics(req, res);
    }
    
    // List memories (with filtering)
    if (req.method === 'GET' && path === '/memories/list') {
      return handleListMemories(req, res);
    }
    
    // Search memories
    if (req.method === 'GET' && path === '/memories' && !path.startsWith('/memories/')) {
      return handleSearchMemories(req, res);
    }
    
    // Store memory
    if (req.method === 'POST' && path === '/memories') {
      return handleStoreMemory(req, res);
    }
    
    // Get memory
    if (req.method === 'GET' && path.startsWith('/memories/') && path !== '/memories') {
      req.query.id = path.split('/')[2];
      return handleGetMemory(req, res);
    }
    
    // Update memory
    if (req.method === 'PATCH' && path.startsWith('/memories/') && path !== '/memories') {
      req.query.id = path.split('/')[2];
      return handleUpdateMemory(req, res);
    }
    
    // Delete memory
    if (req.method === 'DELETE' && path.startsWith('/memories/') && path !== '/memories') {
      req.query.id = path.split('/')[2];
      return handleDeleteMemory(req, res);
    }
    
    // Root
    if (req.method === 'GET' && path === '/') {
      return res.status(200).json({
        name: 'Muninn Cloud API',
        version: '2.0.0',
        docs: 'https://github.com/openclaw/muninn',
        endpoints: {
          health: 'GET /health',
          organizations: 'POST /organizations',
          store: 'POST /memories',
          search: 'GET /memories?q=query',
          get: 'GET /memories/:id',
          delete: 'DELETE /memories/:id',
          audit: 'GET /api?action=audit:health|audit:contradictions|audit:access|audit:staleness'
        }
      });
    }
    
    // Audit endpoints
    if (path === '/audit' || path.startsWith('/audit')) {
      return handleAudit(req, res, ctx);
    }
    
    return res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}