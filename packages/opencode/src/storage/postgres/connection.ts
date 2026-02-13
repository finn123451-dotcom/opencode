import { Database } from 'better-sqlite3';
import pg from 'pg';
import { z } from 'zod';
import { Log } from "../../util/log";

const { Pool } = pg;

const logger = Log.create({ service: "postgres" })

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  maxConnections?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
}

export const PostgresConfigSchema = z.object({
  host: z.string().default('localhost'),
  port: z.number().default(5432),
  database: z.string(),
  user: z.string(),
  password: z.string(),
  maxConnections: z.number().default(20),
  idleTimeoutMs: z.number().default(30000),
  connectionTimeoutMs: z.number().default(5000),
});

let pool: pg.Pool | null = null;

export async function initializePostgres(config: PostgresConfig): Promise<pg.Pool> {
  if (pool) {
    return pool;
  }

  const validatedConfig = PostgresConfigSchema.parse(config);
  
  pool = new Pool({
    host: validatedConfig.host,
    port: validatedConfig.port,
    database: validatedConfig.database,
    user: validatedConfig.user,
    password: validatedConfig.password,
    max: validatedConfig.maxConnections,
    idleTimeoutMillis: validatedConfig.idleTimeoutMs,
    connectionTimeoutMillis: validatedConfig.connectionTimeoutMs,
  });

  pool.on('error', (err) => {
    logger.error("pool error", { error: err });
  });

  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    logger.info("connection established");
  } catch (error) {
    logger.error("failed to connect", { error });
    throw error;
  }

  return pool;
}

export function getPool(): pg.Pool {
  if (!pool) {
    throw new Error('PostgreSQL pool not initialized. Call initializePostgres first.');
  }
  return pool;
}

export async function closePostgres(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info("pool closed");
  }
}

export async function query<T = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>> {
  const pool = getPool();
  return pool.query(text, params);
}

export async function getClient(): Promise<pg.PoolClient> {
  const pool = getPool();
  return pool.connect();
}

export async function transaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }
  
  throw lastError;
}

export async function healthCheck(): Promise<boolean> {
  try {
    const result = await query('SELECT 1 as health');
    return result.rows[0]?.health === 1;
  } catch {
    return false;
  }
}
