# Error Recovery Quick Reference Guide

## Table of Contents
1. [Error Types](#error-types)
2. [Recovery Strategies](#recovery-strategies)
3. [Usage Examples](#usage-examples)
4. [Configuration](#configuration)
5. [Circuit Breaker](#circuit-breaker)
6. [Troubleshooting](#troubleshooting)

## Error Types

### Network Errors
```typescript
import { NetworkError } from './utils/errors';

throw new NetworkError('Connection failed', {
  host: 'api.youtube.com',
  port: 443,
});
```
- **Severity**: MEDIUM
- **Recoverable**: Yes
- **Auto-retry**: Yes with exponential backoff

### Rate Limit Errors
```typescript
import { RateLimitError } from './utils/errors';

throw new RateLimitError('Rate limit exceeded', {
  retryAfter: 60000, // ms to wait before retry
  limit: 100,
  remaining: 0,
});
```
- **Severity**: MEDIUM
- **Recoverable**: Yes
- **Auto-retry**: Yes after specified wait time

### Authentication Errors
```typescript
import { AuthenticationError } from './utils/errors';

throw new AuthenticationError('Token expired', {
  tokenType: 'access',
  expiresAt: Date.now(),
});
```
- **Severity**: HIGH
- **Recoverable**: Yes via token refresh
- **Auto-retry**: Yes after credential refresh

### Sync Conflict Errors
```typescript
import { SyncConflictError } from './utils/errors';

throw new SyncConflictError('Data conflict detected', {
  localVersion: 2,
  remoteVersion: 3,
  conflictField: 'position',
});
```
- **Severity**: MEDIUM
- **Recoverable**: Yes via conflict resolution
- **Auto-retry**: Yes after resolution

### Quota Exceeded Errors
```typescript
import { QuotaExceededError } from './utils/errors';

throw new QuotaExceededError({
  used: 10000,
  limit: 10000,
  resetAt: Date.now() + 86400000, // 24 hours
});
```
- **Severity**: HIGH
- **Recoverable**: No (must wait for quota reset)
- **Auto-retry**: No

## Recovery Strategies

### RETRY (Default)
Applies exponential backoff with jitter
```typescript
// Attempt 1: 1.0-1.3s
// Attempt 2: 2.0-2.6s
// Attempt 3: 4.0-5.2s
// Attempt 4: 8.0-10.4s
// Attempt 5: 16.0-20.8s (capped at maxDelayMs)
```

### WAIT_AND_RETRY
Waits for API-specified time before retry
```typescript
// Uses retryAfter from error details
// Falls back to 60s if not specified
// Capped at maxDelayMs
```

### REFRESH_AND_RETRY
Refreshes authentication credentials before retry
```typescript
// 1. Trigger token refresh
// 2. Apply exponential backoff
// 3. Retry operation with new credentials
```

### RESOLVE_AND_RETRY
Resolves data conflicts before retry
```typescript
// 1. Invoke conflict resolution logic
// 2. Apply exponential backoff
// 3. Retry operation with resolved data
```

### FAIL
Fails immediately without retry
```typescript
// Used for non-recoverable errors:
// - Quota exceeded
// - Validation errors
// - Non-recoverable app errors
```

## Usage Examples

### Basic Usage
```typescript
import { getErrorRecoveryManager } from './utils/error-recovery';

const manager = getErrorRecoveryManager();

const result = await manager.executeWithRecovery(
  async () => {
    return await someAsyncOperation();
  }
);

if (result.success) {
  console.log('Success:', result.data);
} else {
  console.error('Failed:', result.error);
}
```

### With Context
```typescript
const result = await manager.executeWithRecovery(
  async () => await fetchPlaylist(playlistId),
  {
    playlistId,
    operation: 'fetchPlaylist',
    userId: currentUser.id,
  }
);
```

### With Custom Options
```typescript
const manager = getErrorRecoveryManager({
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  enableCircuitBreaker: true,
});
```

### With Callbacks
```typescript
const manager = getErrorRecoveryManager({
  onRecoveryAttempt: (attempt, error, strategy) => {
    console.log(`Attempt ${attempt}: ${strategy}`);
    metrics.increment('recovery.attempt', { strategy });
  },
  onRecoverySuccess: (result) => {
    console.log(`Recovered in ${result.recoveryTime}ms`);
    metrics.timing('recovery.time', result.recoveryTime);
  },
  onRecoveryFailure: (result) => {
    console.error(`Failed after ${result.attemptsUsed} attempts`);
    metrics.increment('recovery.failure');
  },
});
```

## Configuration

### Default Configuration
```typescript
{
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  enableCircuitBreaker: true,
  circuitBreakerOptions: {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000,
  },
}
```

### Recommended Configurations

#### For External APIs
```typescript
{
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  enableCircuitBreaker: true,
  circuitBreakerOptions: {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 120000, // 2 minutes
  },
}
```

#### For Database Operations
```typescript
{
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  enableCircuitBreaker: false,
}
```

#### For Critical Operations
```typescript
{
  maxRetries: 10,
  initialDelayMs: 500,
  maxDelayMs: 60000,
  backoffMultiplier: 1.5,
  enableCircuitBreaker: true,
  circuitBreakerOptions: {
    failureThreshold: 10,
    successThreshold: 3,
    timeout: 300000, // 5 minutes
  },
}
```

#### For Fast-Fail Operations
```typescript
{
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 2000,
  backoffMultiplier: 2,
  enableCircuitBreaker: false,
}
```

## Circuit Breaker

### States

#### CLOSED (Normal Operation)
- All requests are allowed
- Failures are tracked
- Opens after reaching failure threshold

#### OPEN (Service Unavailable)
- All requests are blocked immediately
- No operations are attempted
- Transitions to HALF_OPEN after timeout

#### HALF_OPEN (Testing Recovery)
- Limited requests allowed to test service
- Success advances to CLOSED
- Failure returns to OPEN

### State Diagram
```
       ┌─────────┐
       │ CLOSED  │────failure threshold──┐
       └─────────┘                        │
            ↑                             ↓
    success │                        ┌────────┐
  threshold │                        │  OPEN  │
            │                        └────────┘
            │                             │
            │                        timeout
            │                             │
       ┌─────────┐                        │
       │HALF_OPEN│←───────────────────────┘
       └─────────┘
            │
        failure
            │
            └─────────────────────────────┐
                                          ↓
                                     ┌────────┐
                                     │  OPEN  │
                                     └────────┘
```

### Monitoring Circuit State
```typescript
const manager = getErrorRecoveryManager();

// Check current state
console.log('Circuit state:', manager.getCircuitState());

// Reset circuit manually
manager.resetCircuit();
```

### Circuit Breaker Events
```typescript
// Circuit opened
logger.error('Circuit breaker opened due to repeated failures', {
  failureCount: 5,
  threshold: 5,
});

// Transitioning to half-open
logger.info('Circuit breaker transitioning to HALF_OPEN');

// Circuit closed after recovery
logger.info('Circuit breaker closed after successful recovery');

// Circuit reopened from half-open
logger.warn('Circuit breaker reopened after failure in HALF_OPEN state');
```

## Troubleshooting

### Issue: Operations Always Fail
**Symptoms**: All operations fail even after retries

**Possible Causes**:
1. Circuit breaker is OPEN
2. Max retries too low
3. Non-recoverable error type

**Solutions**:
```typescript
// Check circuit state
const state = manager.getCircuitState();
if (state === CircuitState.OPEN) {
  manager.resetCircuit();
}

// Increase retries
const manager = getErrorRecoveryManager({
  maxRetries: 10,
});

// Check error recoverability
if (error instanceof AppError && !error.recoverable) {
  // Handle non-recoverable error differently
}
```

### Issue: Slow Recovery Time
**Symptoms**: Operations take too long to recover

**Possible Causes**:
1. Backoff multiplier too high
2. Initial delay too high
3. Too many retries

**Solutions**:
```typescript
// Reduce backoff
const manager = getErrorRecoveryManager({
  initialDelayMs: 500,
  backoffMultiplier: 1.5,
  maxDelayMs: 10000,
});

// Reduce retries
const manager = getErrorRecoveryManager({
  maxRetries: 3,
});
```

### Issue: Circuit Opens Too Frequently
**Symptoms**: Circuit breaker opens with minimal failures

**Possible Causes**:
1. Failure threshold too low
2. Service genuinely unstable
3. Network issues

**Solutions**:
```typescript
// Increase threshold
const manager = getErrorRecoveryManager({
  circuitBreakerOptions: {
    failureThreshold: 10,
    successThreshold: 3,
    timeout: 120000,
  },
});

// Or disable circuit breaker
const manager = getErrorRecoveryManager({
  enableCircuitBreaker: false,
});
```

### Issue: Not Retrying Expected Errors
**Symptoms**: Errors that should retry don't retry

**Possible Causes**:
1. Error not marked as recoverable
2. Wrong error type
3. Custom retry logic conflict

**Solutions**:
```typescript
// Check error recoverability
console.log('Recoverable:', error.recoverable);

// Use correct error type
throw new NetworkError('Connection failed'); // Recoverable
// Instead of:
throw new Error('Connection failed'); // May retry but not optimal

// Check for conflicting retry logic
// Remove outer retry() calls when using executeWithRecovery()
```

### Debugging Recovery Process
```typescript
const manager = getErrorRecoveryManager({
  onRecoveryAttempt: (attempt, error, strategy) => {
    console.log(`[DEBUG] Attempt ${attempt}`);
    console.log(`  Error: ${error.message}`);
    console.log(`  Strategy: ${strategy}`);
    console.log(`  Recoverable: ${error instanceof AppError ? error.recoverable : 'unknown'}`);
  },
  onRecoverySuccess: (result) => {
    console.log(`[DEBUG] Success after ${result.attemptsUsed} attempts`);
    console.log(`  Recovery time: ${result.recoveryTime}ms`);
  },
  onRecoveryFailure: (result) => {
    console.log(`[DEBUG] Failed after ${result.attemptsUsed} attempts`);
    console.log(`  Error: ${result.error?.message}`);
    console.log(`  Strategy: ${result.strategy}`);
  },
});
```

## Performance Tips

1. **Use Singleton Pattern**
   ```typescript
   // Good: Reuse instance
   const manager = getErrorRecoveryManager();

   // Bad: Create new instance every time
   // const manager = new ErrorRecoveryManager();
   ```

2. **Set Appropriate Timeouts**
   ```typescript
   // Fast operations
   { maxRetries: 3, initialDelayMs: 100 }

   // Slow operations
   { maxRetries: 5, initialDelayMs: 1000 }
   ```

3. **Use Circuit Breaker for External Services**
   ```typescript
   { enableCircuitBreaker: true }
   ```

4. **Disable Circuit Breaker for Internal Operations**
   ```typescript
   { enableCircuitBreaker: false }
   ```

5. **Provide Context for Better Logging**
   ```typescript
   executeWithRecovery(operation, {
     operation: 'fetchData',
     resource: 'playlist',
     id: playlistId,
   });
   ```

## Best Practices

1. ✅ Always check `result.success` before using `result.data`
2. ✅ Provide meaningful context for debugging
3. ✅ Use appropriate error types for accurate recovery
4. ✅ Monitor recovery metrics in production
5. ✅ Set circuit breaker thresholds based on SLA requirements
6. ✅ Test error scenarios in development
7. ✅ Log recovery attempts for audit trail
8. ❌ Don't nest executeWithRecovery calls
9. ❌ Don't disable circuit breaker for unreliable services
10. ❌ Don't set maxRetries too high (causes delays)

## Additional Resources

- Error classes: `/src/utils/errors.ts`
- Recovery manager: `/src/utils/error-recovery.ts`
- Unit tests: `/tests/unit/utils/error-recovery.test.ts`
- Full documentation: `/ERROR_HANDLING_SUMMARY.md`
