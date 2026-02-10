import { z } from 'zod';
import { PostgresConfigSchema, initializePostgres, closePostgres, getPool } from './connection';

export const TrajectoryStorageConfigSchema = z.object({
  enabled: z.boolean().default(true),
  postgres: PostgresConfigSchema,
  storeEmbeddings: z.boolean().default(true),
  generateKnowledge: z.boolean().default(true),
  captureRate: z.number().min(0).max(1).default(1.0),
  batchSize: z.number().min(1).max(1000).default(100),
  flushInterval: z.number().min(100).max(60000).default(5000),
});

export type TrajectoryStorageConfig = z.infer<typeof TrajectoryStorageConfigSchema>;

let config: TrajectoryStorageConfig | null = null;

export function configureTrajectoryStorage(userConfig: TrajectoryStorageConfig): TrajectoryStorageConfig {
  config = TrajectoryStorageConfigSchema.parse(userConfig);
  return config;
}

export function getTrajectoryStorageConfig(): TrajectoryStorageConfig {
  if (!config) {
    config = {
      enabled: true,
      postgres: {
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432'),
        database: process.env.PGDATABASE || 'opencode',
        user: process.env.PGUSER || 'opencode',
        password: process.env.PGPASSWORD || '',
        maxConnections: parseInt(process.env.PGMAXCONNECTIONS || '20'),
        idleTimeoutMs: parseInt(process.env.PGIDLETIMEOUT || '30000'),
        connectionTimeoutMs: parseInt(process.env.PGCONNECTIONTIMEOUT || '5000'),
      },
      storeEmbeddings: true,
      generateKnowledge: true,
      captureRate: 1.0,
      batchSize: 100,
      flushInterval: 5000,
    };
  }
  return config;
}

export async function initializeStorage(): Promise<void> {
  const storageConfig = getTrajectoryStorageConfig();
  
  if (!storageConfig.enabled) {
    console.log('Trajectory storage is disabled');
    return;
  }

  await initializePostgres(storageConfig.postgres);
  
  console.log('Trajectory storage initialized with config:', {
    host: storageConfig.postgres.host,
    database: storageConfig.postgres.database,
    storeEmbeddings: storageConfig.storeEmbeddings,
    generateKnowledge: storageConfig.generateKnowledge,
  });
}

export async function shutdownStorage(): Promise<void> {
  await closePostgres();
  console.log('Trajectory storage shut down');
}

export async function healthCheck(): Promise<{
  storage: boolean;
  database: boolean;
  embeddings: boolean;
}> {
  const pool = getPool();
  
  try {
    await pool.query('SELECT 1');
    return {
      storage: true,
      database: true,
      embeddings: true,
    };
  } catch (error) {
    console.error('Health check failed:', error);
    return {
      storage: false,
      database: false,
      embeddings: false,
    };
  }
}

export function isStorageEnabled(): boolean {
  const storageConfig = getTrajectoryStorageConfig();
  return storageConfig.enabled;
}
