import { FeatureFlagGuard } from './feature-flag.guard';

describe('FeatureFlagGuard', () => {
  it('should be defined', () => {
    expect(new FeatureFlagGuard()).toBeDefined();
  });
});
