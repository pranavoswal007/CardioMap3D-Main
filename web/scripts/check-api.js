import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');
const currentSchemaPath = path.resolve(webRoot, 'src/api/schema.d.ts');
const tempSchemaPath = path.resolve(webRoot, 'src/api/schema.tmp.d.ts');
const openApiPath = path.resolve(webRoot, '../api/openapi.json');

try {
  if (!fs.existsSync(currentSchemaPath)) {
    console.error('Error: src/api/schema.d.ts does not exist. Run "npm run gen:api" first.');
    process.exit(1);
  }

  execSync(`npx openapi-typescript "${openApiPath}" -o "${tempSchemaPath}"`, {
    cwd: webRoot,
    stdio: 'pipe',
  });

  const currentContent = fs.readFileSync(currentSchemaPath, 'utf8');
  const tempContent = fs.readFileSync(tempSchemaPath, 'utf8');

  if (currentContent !== tempContent) {
    console.error('Error: src/api/schema.d.ts is stale compared to api/openapi.json.');
    console.error('Run "npm run gen:api" to synchronize TypeScript schemas.');
    fs.unlinkSync(tempSchemaPath);
    process.exit(1);
  }

  fs.unlinkSync(tempSchemaPath);
  console.log('✓ src/api/schema.d.ts is up-to-date with api/openapi.json.');
  process.exit(0);
} catch (err) {
  if (fs.existsSync(tempSchemaPath)) {
    fs.unlinkSync(tempSchemaPath);
  }
  console.error('Failed to check api schema staleness:', err.message || err);
  process.exit(1);
}
