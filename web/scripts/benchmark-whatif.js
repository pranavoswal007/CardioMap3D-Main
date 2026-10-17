import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const whatifConfigPath = path.resolve(__dirname, '../src/config/whatif.json');

async function main() {
  console.log('================================================================');
  console.log('What-If Mode Slider-to-Recolor Latency Benchmark');
  console.log('Interaction count: >= 30, Debounce: 150 ms, Backend: http://127.0.0.1:8000');
  console.log('================================================================\n');

  // 1. Fetch baseline sample patient
  const samplesRes = await fetch('http://127.0.0.1:8000/patients/samples');
  if (!samplesRes.ok) {
    throw new Error(`Failed to fetch sample patients: ${samplesRes.statusText}`);
  }
  const samples = await samplesRes.json();
  const baselinePatient = samples[0];
  console.log(`Baseline patient loaded: ${baselinePatient.sample_id} (CAD: ${(baselinePatient.cad_probability * 100).toFixed(1)}%)`);

  // 2. Read what-if factors configuration
  const factors = JSON.parse(fs.readFileSync(whatifConfigPath, 'utf8'));
  console.log(`Configured factors: ${factors.map(f => f.key).join(', ')}\n`);

  const currentInputs = { ...baselinePatient.features };
  const latencies = [];
  const numInteractions = 35;

  console.log('--- Commencing Scripted Slider Interactions ---');

  for (let i = 0; i < numInteractions; i++) {
    const factor = factors[i % factors.length];
    const prevVal = currentInputs[factor.key];
    
    // Choose new test value within min/max bounds
    let newVal;
    if (factor.type === 'toggle') {
      newVal = prevVal === 1 ? 0 : 1;
    } else {
      const span = factor.max - factor.min;
      // Oscillate across range
      const stepFraction = ((i * 7) % 11) / 10;
      newVal = Math.round((factor.min + span * stepFraction) / factor.step) * factor.step;
      if (factor.step < 1) newVal = Number(newVal.toFixed(1));
    }

    currentInputs[factor.key] = newVal;

    // Derived field rule: when Weight changes, recompute BMI from Weight and Length
    if (factor.key === 'Weight') {
      const lengthCm = Number(currentInputs['Length'] || 165);
      const heightM = lengthCm / 100;
      currentInputs['BMI'] = Number((newVal / (heightM * heightM)).toFixed(2));
    }

    // Measure slider-to-recolor latency:
    // User moves slider at t0 -> 150 ms debounce -> POST /predict -> response parsed and ready to recolor at t1
    const t0 = performance.now();

    // 150 ms debounce delay
    await new Promise((resolve) => setTimeout(resolve, 150));

    // AbortController setup
    const controller = new AbortController();
    const res = await fetch('http://127.0.0.1:8000/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentInputs),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`POST /predict failed with status ${res.status}`);
    }

    const json = await res.json();
    const t1 = performance.now();
    const latency = t1 - t0;
    latencies.push(latency);

    const cadP = (json.cad.probability * 100).toFixed(1);
    console.log(
      `[Interaction ${(i + 1).toString().padStart(2, ' ')}/${numInteractions}] ` +
      `Factor: ${factor.key.padEnd(14, ' ')} = ${newVal.toString().padEnd(6, ' ')} ` +
      `-> debounced POST /predict (200 OK, CAD: ${cadP}%) ` +
      `-> recolor ready in ${latency.toFixed(2)} ms`
    );
  }

  // 3. Compute statistics
  const sorted = [...latencies].sort((a, b) => a - b);
  const count = sorted.length;
  const p50 = sorted[Math.floor(count * 0.5)];
  const p95 = sorted[Math.min(count - 1, Math.floor(count * 0.95))];
  const min = sorted[0];
  const max = sorted[count - 1];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / count;

  console.log('\n================================================================');
  console.log('LATENCY BENCHMARK RESULTS');
  console.log('================================================================');
  console.log(`Interactions Tested : ${count}`);
  console.log(`p50 Latency         : ${p50.toFixed(2)} ms`);
  console.log(`p95 Latency         : ${p95.toFixed(2)} ms`);
  console.log(`Min Latency         : ${min.toFixed(2)} ms`);
  console.log(`Max Latency         : ${max.toFixed(2)} ms`);
  console.log(`Mean Latency        : ${mean.toFixed(2)} ms`);
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
