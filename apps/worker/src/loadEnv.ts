// Side-effect-only module: loading this file populates process.env from
// the worker's .env file. Import it as the FIRST line of main.ts (before
// any module that reads process.env, especially ./config).
//
// Why a separate file instead of inline `dotenv.config()` at the top of
// main.ts: under ES module semantics (tsconfig.module = esnext/node16),
// every `import` statement is hoisted and the imported module's body runs
// before any code in the importing module. Inline dotenv.config() would
// execute AFTER `import { config } from './config'` had already resolved
// process.env to its empty/stale values — silently re-introducing the
// fallback-to-mock bug this file exists to prevent.
//
// As a side-effect module its body runs at import-resolution time, in the
// order the imports appear in main.ts. So `import './loadEnv'` first means
// dotenv finishes before './config' is evaluated, regardless of tsconfig
// module target.
//
// override:true so the .env file is authoritative — defeats stale empty
// values inherited from a previous shell `export` (e.g. ANTHROPIC_API_KEY=
// left in the environment from a half-baked `set -a; source .env` session).

import * as dotenv from 'dotenv';
dotenv.config({ override: true });
