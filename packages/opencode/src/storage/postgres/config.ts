import { z } from 'zod';
import { PostgresConfigSchema, initializePostgres, closePostgres, getPool } from './connection';
import { Log } from "../../util/log";

const logger = Log.create({ service: "trajectory-storage" })

export const TrajectoryStorageConfigSchema = z.object({
  enabled: z.boolean().default(true),
  postgres: PostgresConfigSchema,
  storeEmbeddings: z.boolean().default(true),
  generateKnowledge: z.boolean().default(true),
  captureRate: z.number().min(0).max(1).default(1.0),
  batchSize: z.number().min(1).max(1000).default(100),
  flushInterval: z.number().min(100).max(60000).default(5000),
  aiEnabled: z.boolean().default(undefined),
});

export type TrajectoryStorageConfig = z.infer<typeof TrajectoryStorageConfigSchema>;

let config: TrajectoryStorageConfig | null = null;

export function configureTrajectoryStorage(userConfig: TrajectoryStorageConfig): TrajectoryStorageConfig {
  config = TrajectoryStorageConfigSchema.parse(userConfig);
  return config;
}

export function getTrajectoryStorageConfig(): TrajectoryStorageConfig {
  if (!config) {
    const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
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
      storeEmbeddings: hasOpenAIKey,
      generateKnowledge: hasOpenAIKey,
      captureRate: 1.0,
      batchSize: 100,
      flushInterval: 5000,
      aiEnabled: hasOpenAIKey,
    };
  }
  return config;
}

export function isAIEnabled(): boolean {
  const storageConfig = getTrajectoryStorageConfig();
  if (storageConfig.aiEnabled !== undefined) {
    return storageConfig.aiEnabled;
  }
  return !!process.env.OPENAI_API_KEY;
}

export async function initializeStorage(): Promise<void> {
  const storageConfig = getTrajectoryStorageConfig();
  
  if (!storageConfig.enabled) {
    logger.info("storage is disabled");
    return;
  }

  await initializePostgres(storageConfig.postgres);
  
  logger.info("initialized", {
    host: storageConfig.postgres.host,
    database: storageConfig.postgres.database,
    storeEmbeddings: storageConfig.storeEmbeddings,
    generateKnowledge: storageConfig.generateKnowledge,
  });
}

export async function shutdownStorage(): Promise<void> {
  await closePostgres();
  logger.info("shutdown");
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
    logger.error("health check failed", { error });
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
