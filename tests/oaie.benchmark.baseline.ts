import {
  analyzeTask,
  BENCHMARK_OFFLINE_NETWORK,
  BENCHMARK_ONLINE_NETWORK,
  BENCHMARK_SLOW_NETWORK,
  buildExecutionPlan,
  buildModelRegistry,
  decideRoute,
  DEFAULT_CUSTOM_PREFERENCES,
  rehydrateLocalPlaceholders,
  REPRESENTATIVE_BENCHMARK_TASKS,
  SYNTHETIC_DEVICE_TIERS,
  type TaskInput,
} from '../src/engine';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

function nowUs(): number {
  return Number(process.hrtime.bigint()) / 1000;
}

const ITERATIONS = 50;

console.log('===================================================================');
console.log('ORBIT AI — PHASE 2 BASELINE OAIE BENCHMARK (NODE HARNESS)');
console.log('NOTE: Device profiles below are SYNTHETIC harness simulations, NOT physical hardware.');
console.log(`Samples per benchmark prompt/tier: N = ${ITERATIONS}`);
console.log('===================================================================\n');

// 1. Representative 8-Task Engine Pipeline Overhead & Routing Accuracy (Simulated 16 GB Local-Ready Chrome)
const baselineHighDevice = SYNTHETIC_DEVICE_TIERS[3].device;
const baselineModels = buildModelRegistry({
  device: baselineHighDevice,
  network: BENCHMARK_ONLINE_NETWORK,
  cloudGeminiConfigured: true,
  firebaseAiLogicConfigured: false,
  cloudRequiresAuth: false,
  cloudAuthenticated: true,
});

console.log('--- 1. REPRESENTATIVE 8-TASK ROUTING ACCURACY & PIPELINE OVERHEAD ---');
let exactTypeMatches = 0;
let exactRouteMatches = 0;

for (const spec of REPRESENTATIVE_BENCHMARK_TASKS) {
  const analyzeTimesUs: number[] = [];
  const routeTimesUs: number[] = [];
  const planTimesUs: number[] = [];
  let lastAnalysis = analyzeTask(spec.input);
  let lastDecision = decideRoute({
    analysis: lastAnalysis,
    device: baselineHighDevice,
    network: BENCHMARK_ONLINE_NETWORK,
    models: baselineModels,
    privacyMode: spec.privacyMode,
    customPreferences: DEFAULT_CUSTOM_PREFERENCES,
  });
  let lastPlan = buildExecutionPlan({
    input: spec.input,
    analysis: lastAnalysis,
    decision: lastDecision,
  });

  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = nowUs();
    const analysis = analyzeTask(spec.input);
    const t1 = nowUs();
    const decision = decideRoute({
      analysis,
      device: baselineHighDevice,
      network: BENCHMARK_ONLINE_NETWORK,
      models: baselineModels,
      privacyMode: spec.privacyMode,
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });
    const t2 = nowUs();
    const plan = buildExecutionPlan({
      input: spec.input,
      analysis,
      decision,
    });
    const t3 = nowUs();

    analyzeTimesUs.push(t1 - t0);
    routeTimesUs.push(t2 - t1);
    planTimesUs.push(t3 - t2);
    lastAnalysis = analysis;
    lastDecision = decision;
    lastPlan = plan;
  }

  analyzeTimesUs.sort((a, b) => a - b);
  routeTimesUs.sort((a, b) => a - b);
  planTimesUs.sort((a, b) => a - b);

  const typeOk = lastAnalysis.taskType === spec.expectedTaskType;
  const routeOk = lastDecision.selectedRoute === spec.expectedRouteWhenLocalReadyBalanced;
  if (typeOk) exactTypeMatches++;
  if (routeOk) exactRouteMatches++;

  const rehydratedCheck =
    lastDecision.selectedRoute === 'HYBRID' && lastPlan.sanitizedPrompt
      ? rehydrateLocalPlaceholders(lastPlan.sanitizedPrompt, lastPlan.redactionMap)
      : '';

  console.log(
    JSON.stringify({
      id: spec.id,
      expectedType: spec.expectedTaskType,
      actualType: lastAnalysis.taskType,
      typeOk,
      complexity: lastAnalysis.complexity,
      expectedRoute: spec.expectedRouteWhenLocalReadyBalanced,
      actualRoute: lastDecision.selectedRoute,
      routeOk,
      model: lastDecision.selectedLocalModelId || lastDecision.selectedCloudModelId || 'none',
      estLatencyMs: lastDecision.estimatedLatencyMs,
      estCostUsd: lastDecision.estimatedCostUsd,
      redactedCount: lastPlan.redactedCount,
      hybridRoundTripPreserved:
        lastDecision.selectedRoute === 'HYBRID' ? rehydratedCheck.length > 0 : null,
      analyzeP50Us: Math.round(percentile(analyzeTimesUs, 0.5)),
      analyzeP95Us: Math.round(percentile(analyzeTimesUs, 0.95)),
      decideP50Us: Math.round(percentile(routeTimesUs, 0.5)),
      planP50Us: Math.round(percentile(planTimesUs, 0.5)),
    })
  );
}
console.log(
  `\nRepresentative Suite Summary: TaskType Match = ${exactTypeMatches}/${REPRESENTATIVE_BENCHMARK_TASKS.length}, Route Match = ${exactRouteMatches}/${REPRESENTATIVE_BENCHMARK_TASKS.length}\n`
);

// 2. Adversarial Classification & PII Stress Audit (Testing Keyword Blind Spots)
console.log('--- 2. ADVERSARIAL TASK CLASSIFIER & PII BLIND-SPOT AUDIT ---');
const adversarialCases: Array<{ label: string; expectedIntent: string; input: TaskInput }> = [
  {
    label: 'natural_language_coding_without_keyword',
    expectedIntent: 'coding_technical',
    input: { prompt: 'How do I debounce search input updates cleanly in my web app?' },
  },
  {
    label: 'arabic_coding_with_translation_word',
    expectedIntent: 'coding_technical',
    input: { prompt: 'أصلح هذا الخطأ البرمجي في كود React عند ترجمة الواجهة.' },
  },
  {
    label: 'short_1500_token_medium_qa',
    expectedIntent: 'simple_qa_or_reasoning',
    input: { prompt: 'Explain microservice circuit breakers in depth: ' + 'context '.repeat(350) },
  },
  {
    label: 'non_us_phone_and_bearer_jwt',
    expectedIntent: 'containsPii_true',
    input: { prompt: 'Call +971 50 123 4567 with Authorization Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig' },
  },
];

for (const c of adversarialCases) {
  const res = analyzeTask(c.input);
  console.log(
    JSON.stringify({
      label: c.label,
      expectedIntent: c.expectedIntent,
      actualTaskType: res.taskType,
      complexity: res.complexity,
      containsPii: res.containsPii,
      piiSpanCount: res.piiSpans.length,
    })
  );
}

// 3. Simulated Device RAM Tier Matrix (2 GB / 4 GB / 6 GB / 16 GB) & Network Matrix
console.log('\n--- 3. SYNTHETIC DEVICE RAM TIER & NETWORK MATRIX (SIMULATED PROFILES) ---');
const matrixTasks = [
  REPRESENTATIVE_BENCHMARK_TASKS[0], // Simple QA
  REPRESENTATIVE_BENCHMARK_TASKS[1], // Summarization
  REPRESENTATIVE_BENCHMARK_TASKS[5], // Coding
  REPRESENTATIVE_BENCHMARK_TASKS[6], // PII Hybrid
];

for (const tier of SYNTHETIC_DEVICE_TIERS) {
  for (const [netName, net] of [
    ['online_4g', BENCHMARK_ONLINE_NETWORK],
    ['slow_2g', BENCHMARK_SLOW_NETWORK],
    ['offline', BENCHMARK_OFFLINE_NETWORK],
  ] as const) {
    const models = buildModelRegistry({
      device: tier.device,
      network: net,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
      cloudRequiresAuth: false,
      cloudAuthenticated: true,
    });

    const summary = matrixTasks.map((task) => {
      const analysis = analyzeTask(task.input);
      const dec = decideRoute({
        analysis,
        device: tier.device,
        network: net,
        models,
        privacyMode: 'BALANCED',
        customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      });
      return `${task.id.replace('bench_0', '')}:${dec.selectedRoute}(${dec.selectedLocalModelId || dec.selectedCloudModelId || 'none'})`;
    });

    console.log(`${tier.id.padEnd(14)} | ${netName.padEnd(9)} | ${summary.join(' | ')}`);
  }
}

console.log('\n--- 4. STRICT_LOCAL ON CONSTRAINED 2GB VS 4GB ENTRY DEVICE (SIMULATED) ---');
for (const tier of SYNTHETIC_DEVICE_TIERS) {
  const models = buildModelRegistry({
    device: tier.device,
    network: BENCHMARK_ONLINE_NETWORK,
    cloudGeminiConfigured: true,
    firebaseAiLogicConfigured: false,
  });
  const dec = decideRoute({
    analysis: analyzeTask(REPRESENTATIVE_BENCHMARK_TASKS[0].input),
    device: tier.device,
    network: BENCHMARK_ONLINE_NETWORK,
    models,
    privacyMode: 'STRICT_LOCAL',
    customPreferences: DEFAULT_CUSTOM_PREFERENCES,
  });
  console.log(
    JSON.stringify({
      tier: tier.id,
      deviceMemoryGb: tier.device.deviceMemoryGb,
      storageQuotaMb: tier.device.storageQuotaMb,
      resourceConstrained: tier.device.resourceConstrained,
      strictLocalRoute: dec.selectedRoute,
      modelId: dec.selectedLocalModelId,
    })
  );
}
