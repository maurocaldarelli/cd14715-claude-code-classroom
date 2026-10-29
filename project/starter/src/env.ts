/**
 * Load .env into process.env.
 *
 * `override: true` makes the project's .env win over variables already set in
 * the shell (for example a system-wide ANTHROPIC_BASE_URL), which would
 * otherwise send the key to the wrong endpoint. Import this module first:
 * other modules read process.env at load time.
 */
import dotenv from 'dotenv';

dotenv.config({ override: true });
