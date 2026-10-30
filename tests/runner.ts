/**
 * Master E2E Test Suite Runner for FocusGlass (Tiers 1-4)
 */

import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { resolve } from 'node:path';

const testFiles = [
  // Tier 1: Feature Coverage (>=5 tests per core feature)
  resolve('tests/tier1_features/opacityTransitions.test.ts'),
  resolve('tests/tier1_features/clickThrough.test.ts'),
  resolve('tests/tier1_features/trainingModes.test.ts'),
  resolve('tests/tier1_features/thresholdAdjustment.test.ts'),
  resolve('tests/tier1_features/telemetryStream.test.ts'),
  resolve('tests/tier1_features/electrodeQuality.test.ts'),

  // Tier 2: Boundary & Corner Cases
  resolve('tests/tier2_boundaries/extremeLimits.test.ts'),
  resolve('tests/tier2_boundaries/rapidSliders.test.ts'),
  resolve('tests/tier2_boundaries/artifactSuppression.test.ts'),

  // Tier 3: Cross-Feature Combinations
  resolve('tests/tier3_combinations/dimmingAudio.test.ts'),
  resolve('tests/tier3_combinations/calibrationThreshold.test.ts'),
  resolve('tests/tier3_combinations/modeSwitching.test.ts'),

  // Tier 4: Real-World Application Scenarios
  resolve('tests/tier4_scenarios/pomodoroSession.test.ts'),

  // Tier 5: Production App Services Verification (src/services/*)
  resolve('tests/tier5_production_app/productionServices.test.ts'),
];

console.log('================================================================');
console.log('  FocusGlass E2E Dual Track Verification Suite (Tiers 1-4)');
console.log('================================================================');
console.log(`Executing ${testFiles.length} test files across 4 tiers...\n`);

const stream = run({
  files: testFiles,
});

stream.compose(new spec()).pipe(process.stdout);

let hasFailures = false;

stream.on('test:fail', () => {
  hasFailures = true;
});

stream.on('end', () => {
  console.log('\n================================================================');
  if (hasFailures) {
    console.error('❌ E2E Test Suite FAILED: one or more tests failed.');
    process.exit(1);
  } else {
    console.log('✅ E2E Test Suite PASSED: All 4 tiers verified successfully!');
    console.log('================================================================');
    process.exit(0);
  }
});
