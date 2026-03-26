import { startSolverServer } from '../electron/services/solver/SolverServer';
import { Logger } from '../electron/utils/Logger';

const logger = Logger.create('FoundryBoot');

logger.info('Initializing Nirvana Foundry (CAPTCHA Solver Platform)...');

try {
  startSolverServer();
  logger.info('Foundry Boot Sequence Complete. Ready to accept Turnstile challenge evasion commands.');
} catch (e: any) {
  logger.error('Failed to boot Foundry: ' + e.message);
}
