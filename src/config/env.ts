import dotenv from "dotenv";

dotenv.config();

export enum RuntimeEnvironment {
  DEVELOPMENT = "development",
  PRODUCTION = "production",
  TEST = "test",
}

export enum EnvVar {
  NODE_ENV = "NODE_ENV",
  PORT = "PORT",
  REDIS_URL = "REDIS_URL",
  CORS_ORIGIN = "CORS_ORIGIN",
  FIREBASE_PROJECT_ID = "FIREBASE_PROJECT_ID",
  FIREBASE_SERVICE_ACCOUNT_JSON = "FIREBASE_SERVICE_ACCOUNT_JSON",
  GOOGLE_APPLICATION_CREDENTIALS = "GOOGLE_APPLICATION_CREDENTIALS",
  USE_IN_MEMORY_REDIS = "USE_IN_MEMORY_REDIS",
}

export const DEFAULT_ENV = {
  NODE_ENV: RuntimeEnvironment.DEVELOPMENT,
  PORT: 4000,
  REDIS_URL: "redis://localhost:6379",
  CORS_ORIGIN: "*",
} as const;

const readEnv = (key: EnvVar) => process.env[key];

const parsePort = (value?: string) => {
  if (!value) return DEFAULT_ENV.PORT;

  const port = Number.parseInt(value, 10);
  return Number.isFinite(port) ? port : DEFAULT_ENV.PORT;
};

const nodeEnv =
  readEnv(EnvVar.NODE_ENV) || DEFAULT_ENV.NODE_ENV;

export const env = Object.freeze({
  nodeEnv,
  isProduction: nodeEnv === RuntimeEnvironment.PRODUCTION,
  port: parsePort(readEnv(EnvVar.PORT)),
  redisUrl: readEnv(EnvVar.REDIS_URL) || DEFAULT_ENV.REDIS_URL,
  useInMemoryRedis: readEnv(EnvVar.USE_IN_MEMORY_REDIS) === "true",
  corsOrigin: readEnv(EnvVar.CORS_ORIGIN) || DEFAULT_ENV.CORS_ORIGIN,
  firebaseProjectId: readEnv(EnvVar.FIREBASE_PROJECT_ID),
  firebaseServiceAccountJson: readEnv(EnvVar.FIREBASE_SERVICE_ACCOUNT_JSON),
  googleApplicationCredentials: readEnv(EnvVar.GOOGLE_APPLICATION_CREDENTIALS),
});
