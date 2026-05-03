import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '50mb' }));

async function loadHandler(name: string) {
  const mod = await import(`./api/${name}.ts`);
  return mod.default;
}

const API_ROUTES = [
  'generate-ideas',
  'generate-ideas-deepseek',
  'generate-proof',
  'generate-proof-deepseek',
  'verify-proof',
  'verify-proof-deepseek',
  'revise-proof',
  'revise-proof-deepseek',
  'literature-search',
  'ingest-paper',
];

for (const route of API_ROUTES) {
  app.post(`/api/${route}`, async (req, res) => {
    try {
      const handler = await loadHandler(route);
      await handler(req, res);
    } catch (error) {
      console.error(`[/api/${route}] Unhandled error:`, error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });
}

const PORT = parseInt(process.env.PORT || '3001', 10);

app.listen(PORT, () => {
  console.log(`\n  API server running at http://localhost:${PORT}`);
  console.log(`  Routes: ${API_ROUTES.map((r) => `/api/${r}`).join(', ')}\n`);
});

export default app;
