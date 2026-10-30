import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const loaderUrl = pathToFileURL(resolve('tests/tsLoader.mjs')).href;

const testFiles = [
  // Tier 1: Core Feature Coverage & Live Src Integration
  resolve('tests/tier1_features/opacityTransitions.test.ts'),
  resolve('tests/tier1_features/clickThrough.test.ts'),
  resolve('tests/tier1_features/trainingModes.test.ts'),
  resolve('tests/tier1_features/thresholdAdjustment.test.ts'),
  resolve('tests/tier1_features/telemetryStream.test.ts'),
  resolve('tests/tier1_features/electrodeQuality.test.ts'),
  resolve('tests/tier1_features/liveEngineIntegration.test.ts'),

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
];

console.log(`Running FocusGlass test suite (${testFiles.length} files)...\n`);

const stream = run({
  files: testFiles,
  execArgv: ['--import', loaderUrl],
});

stream.compose(new spec()).pipe(process.stdout);

let hasFailures = false;

stream.on('test:fail', () => {
  hasFailures = true;
});

stream.on('end', () => {
  if (hasFailures) {
    console.error('\nTest suite failed.');
    process.exit(1);
  } else {
    console.log('\nAll tests passed.');
    process.exit(0);
  }
});
