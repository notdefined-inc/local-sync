# LocalSync SDK Testing Guide

## Overview

Comprehensive Vitest test suite for the LocalSync core SDK components.

## Test Files

```
packages/core/src/__tests__/
├── utils.test.ts         # Utils & checkpoint operations
├── crypto.test.ts        # Cryptographic primitives
├── nip49.test.ts         # Vault encryption format
├── space-keys.test.ts    # Space key envelopes
├── vault.test.ts         # Vault behavior
├── integration.test.ts   # SDK integration tests
└── e2e.test.ts           # End-to-end workflow tests
```

## Running Tests

### All Tests
```bash
pnpm test
```

### LocalSync SDK Tests Only
```bash
pnpm test packages/core/src/__tests__
```

### Watch Mode
```bash
pnpm test -- --watch
```

### With Coverage
```bash
pnpm test -- --coverage
```

### Single Test File
```bash
pnpm test packages/core/src/__tests__/utils.test.ts
```

## Test Coverage

### ✅ utils.test.ts
- Branded type constructors
- §5.1.1 ReplicaId generation (deterministic)
- Content addressing (blobId, spaceTopic)
- Checkpoint operations (merge, gte, equal)
- §10.4 Retry with exponential backoff
- Debounce utility

### ✅ crypto.test.ts
- §6.4.2 HKDF-SHA256 key derivation
- §6.4.2 XChaCha20-Poly1305 encryption/decryption
- §6.4.3 Compression → encrypt pipeline
- §6.4.1 BIP340 Schnorr signatures
- Random key generation

### ✅ Engine + OPFS tests
Engine/storage tests live in `packages/engine-crsqlite-web/src/__tests__`.

### ✅ integration.test.ts
- §14.1 Client initialization
- §14.2 Identity management
- Error handling

## Test Configuration

See `packages/core/vitest.config.ts` for test configuration:
- Environment: jsdom
- Coverage: v8 provider
- Excludes: test files, examples

## Mocked APIs

OPFS mocks live in `packages/engine-crsqlite-web/src/__tests__/setup.ts`.

## Known Limitations

### Phase 1 Scope
Some tests are expected to fail or be incomplete:
- Full vault implementation (login/logout)
- Replication protocol (getChanges, applyChanges)
- WebRTC transport
- Nostr control plane

These will be completed in Phase 2+.

## Adding New Tests

1. Create test file in `packages/core/src/__tests__/`
2. Import from parent directory: `import { ... } from '../module'`
3. Use Vitest globals: `describe`, `it`, `expect`, `vi`
4. Follow existing test structure
5. Add spec section references in comments

## Debugging Tests

### Verbose Output
```bash
pnpm test -- --reporter=verbose
```

### Single Test
```bash
pnpm test -- -t "should generate deterministic replicaId"
```

### Debug Mode
```bash
pnpm test -- --inspect-brk
```

## CI/CD Integration

Add to GitHub Actions:
```yaml
- name: Run LocalSync SDK Tests
  run: pnpm test packages/core/src/__tests__
```

## Next Steps

- [ ] Add E2E tests with real ADHD dashboard
- [ ] Add performance benchmarks
- [ ] Add mutation testing
- [ ] Increase coverage to 90%+
