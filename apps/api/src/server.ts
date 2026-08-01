import { loadConfig } from './config';
import { createLogger } from './logger';
import { buildDeps } from './deps';
import { createApp } from './app';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config);
  const deps = await buildDeps(config, logger);
  const app = createApp(deps);

  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'pi-wren api listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('failed to start api server', error);
  process.exit(1);
});
