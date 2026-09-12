import 'dotenv/config';
import { app } from './app';
import { createLogger } from './logger';

const logger = createLogger('api');
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'EDGAR Radar API listening');
});
