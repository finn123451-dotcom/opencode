import { getPool } from './connection';
import { isAIEnabled } from './config';
import crypto from 'crypto';

export interface EmbeddingOptions {
  model?: string;
  dimensions?: number;
}

export interface SearchOptions {
  limit?: number;
  threshold?: number;
}

export async function generateEmbedding(
  content: string,
  options: EmbeddingOptions = {}
): Promise<number[]> {
  if (!isAIEnabled()) {
    throw new Error('AI features are disabled. Set OPENAI_API_KEY or enable aiEnabled in config.');
  }

  const model = options.model || 'text-embedding-3-small';
  const dimensions = options.dimensions || 1536;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required for embeddings');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: content,
      dimensions,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding generation failed: ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

export async function storeEmbedding(
  entityType: string,
  entityId: string,
  content: string,
  embedding: number[],
  options: EmbeddingOptions = {}
): Promise<string> {
  const pool = getPool();
  const id = crypto.randomUUID();
  const model = options.model || 'text-embedding-3-small';

  const query = `
    INSERT INTO vector_embeddings (id, entity_type, entity_id, content, embedding, model)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO UPDATE SET
      content = $4,
      embedding = $5,
      model = $6,
      created_at = NOW()
    RETURNING id
  `;

  await pool.query(query, [id, entityType, entityId, content, embedding, model]);
  return id;
}

export async function searchSimilarEmbeddings(
  queryEmbedding: number[],
  entityType?: string,
  options: SearchOptions = {}
): Promise<Array<{ id: string; entity_type: string; entity_id: string; content: string; similarity: number }>> {
  const pool = getPool();
  const limit = options.limit || 10;
  const threshold = options.threshold || 0.0;

  let query = `
    SELECT 
      id,
      entity_type,
      entity_id,
      content,
      1 - (embedding <=> $1) as similarity
    FROM vector_embeddings
    WHERE 1 = 1
  `;
  
  const params: any[] = [queryEmbedding];
  let paramIndex = 2;

  if (entityType) {
    query += ` AND entity_type = $${paramIndex}`;
    params.push(entityType);
    paramIndex++;
  }

  query += ` AND (1 - (embedding <=> $1)) >= $${paramIndex}`;
  params.push(threshold);
  paramIndex++;

  query += ` ORDER BY embedding <=> $1 LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await pool.query(query, params);
  return result.rows;
}

export async function deleteEmbeddings(entityType: string, entityId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    'DELETE FROM vector_embeddings WHERE entity_type = $1 AND entity_id = $2',
    [entityType, entityId]
  );
}

export async function updateEmbedding(
  id: string,
  content: string,
  embedding: number[]
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE vector_embeddings 
     SET content = $1, embedding = $2, created_at = NOW()
     WHERE id = $3`,
    [content, embedding, id]
  );
}

export async function getEmbeddingById(id: string): Promise<{
  id: string;
  entity_type: string;
  entity_id: string;
  content: string;
  embedding: number[];
} | null> {
  const pool = getPool();
  const result = await pool.query(
    'SELECT * FROM vector_embeddings WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

export async function getEmbeddingsByEntity(
  entityType: string,
  entityId: string
): Promise<Array<{ id: string; content: string; embedding: number[] }>> {
  const pool = getPool();
  const result = await pool.query(
    'SELECT id, content, embedding FROM vector_embeddings WHERE entity_type = $1 AND entity_id = $2',
    [entityType, entityId]
  );
  return result.rows;
}

export async function batchStoreEmbeddings(
  embeddings: Array<{
    entityType: string;
    entityId: string;
    content: string;
    embedding: number[];
    model?: string;
  }>
): Promise<string[]> {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const ids: string[] = [];
    
    for (const emb of embeddings) {
      const id = crypto.randomUUID();
      const model = emb.model || 'text-embedding-3-small';
      
      await client.query(
        `INSERT INTO vector_embeddings (id, entity_type, entity_id, content, embedding, model)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, emb.entityType, emb.entityId, emb.content, emb.embedding, model]
      );
      
      ids.push(id);
    }
    
    await client.query('COMMIT');
    return ids;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function cosineSimilarity(
  embedding1: number[],
  embedding2: number[]
): Promise<number> {
  const dotProduct = embedding1.reduce((sum, val, i) => sum + val * embedding2[i], 0);
  const magnitude1 = Math.sqrt(embedding1.reduce((sum, val) => sum + val * val, 0));
  const magnitude2 = Math.sqrt(embedding2.reduce((sum, val) => sum + val * val, 0));
  
  return dotProduct / (magnitude1 * magnitude2);
}
