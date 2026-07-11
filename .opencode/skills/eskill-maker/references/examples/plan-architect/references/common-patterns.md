# Common Implementation Patterns

Detailed guidance for common implementation scenarios. This is referenced from the main SKILL.md.

## Token Tracking Implementation

When implementing token tracking:

### Research Phase
1. Find exact API response formats for each provider (OpenAI, Anthropic, Google, etc.)
2. Identify where token extraction happens in the streaming flow
3. Research event emitter patterns used in the codebase

### Design Phase
1. Design the event emitter pattern for real-time updates
2. Consider context window sizes per model (e.g., GPT-4 128k, Claude 200k)
3. Plan for token rollover handling
4. Consider batch vs real-time counting

### Implementation Pattern
```typescript
// Event emitter for token updates
interface TokenUpdate {
  provider: 'openai' | 'anthropic' | 'google';
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: Date;
}

// Use existing event emitter pattern in codebase
class TokenTracker extends EventEmitter {
  emitUsage(update: TokenUpdate): void {
    this.emit('usage', update);
  }
}
```

### Verification
- [ ] Test with each provider's API
- [ ] Verify streaming vs non-streaming token counts
- [ ] Test context window overflow handling
- [ ] Verify rollover accounting

## TUI Implementation

When implementing Terminal User Interfaces:

### Research Phase
1. **Framework choice**: Compare Ratatui (Rust), Bubble Tea (Go), Textual (Python)
2. **Architecture pattern**: Imperative vs reconciler (diffing)
3. **Rendering**: Immediate mode vs buffered (immediate is easier, buffered is more performant)
4. **Platform requirements**: Zig for OpenTUI, Rust for Ratatui

### Design Phase
1. Design component hierarchy first
2. Plan state management
3. Consider input handling (keybindings, mouse support)
4. Plan for async data updates

### Component Hierarchy Example
```
App
├── Header (title, status)
├── MetricsGrid
│   ├── MetricCard (requests)
│   ├── MetricCard (latency)
│   └── MetricCard (errors)
├── Chart (time series)
└── Footer (navigation hints)
```

### Database Migrations

When planning database changes:

### Research Phase
1. Check if it's a fresh database or needs backwards compatibility
2. Research migration naming conventions
3. Find existing migration patterns in the codebase

### Planning Checklist
- [ ] Is this a breaking change or additive?
- [ ] What's the rollback strategy?
- [ ] Do existing rows need migration scripts?
- [ ] What's the deployment order?

### Migration Template
```sql
-- migrations/20240115_add_oauth_to_users.up.sql
ALTER TABLE users ADD COLUMN oauth_provider VARCHAR(50);
ALTER TABLE users ADD COLUMN oauth_id VARCHAR(255);
ALTER TABLE users ADD COLUMN oauth_token_encrypted TEXT;

-- migrations/20240115_add_oauth_to_users.down.sql
ALTER TABLE users DROP COLUMN oauth_provider;
ALTER TABLE users DROP COLUMN oauth_id;
ALTER TABLE users DROP COLUMN oauth_token_encrypted;
```

### API Changes

When changing APIs:

### Research Phase
1. Find all call sites first (`grep` for the endpoint)
2. Check API versioning strategy used
3. Look for existing deprecation patterns

### Planning Checklist
- [ ] Map all existing call sites
- [ ] Plan backwards-compatible transition
- [ ] Document breaking changes explicitly
- [ ] Plan deprecation timeline

### Rollout Strategy
```
Phase 1: Add new endpoint alongside old (both work)
Phase 2: Update clients to use new endpoint
Phase 3: Deprecate old endpoint (log warnings)
Phase 4: Remove old endpoint
```

### Adding Authentication

When adding auth (OAuth, SAML, etc.):

### Research Phase
1. Compare OAuth 2.0 vs SAML vs OIDC
2. Research provider support (Google, GitHub, Okta, Auth0)
3. Find existing auth patterns in codebase

### Decision Framework
| Factor | OAuth 2.0 | SAML | OIDC |
|--------|-----------|------|------|
| Complexity | Medium | High | Medium |
| Browser support | Excellent | Good | Excellent |
| Mobile support | Excellent | Poor | Excellent |
| Token format | Bearer | XML assertion | JWT |

### Security Checklist
- [ ] Store tokens encrypted
- [ ] Implement token refresh
- [ ] Handle revocation
- [ ] Validate redirects (prevent open redirect)
- [ ] Use state parameter to prevent CSRF

## Building CLIs

When building command-line tools:

### Research Phase
1. Choose CLI framework (Clap for Rust, Cobra for Go, Click for Python)
2. Research shell completion patterns
3. Consider cross-platform requirements (Windows, macOS, Linux)

### Design Principles
1. **Composability**: `cmd --output json | jq '.items'`
2. **Defaults**: Sensible out of the box, overridable
3. **Error messages**: Explain what went wrong and how to fix it
4. **Progress**: Show progress for long operations

### Output Format Example
```
# Human-readable (default)
$ mycli process-file input.txt
Processing... done (3.2s)

# Machine-readable (explicit)
$ mycli --format json process-file input.txt
{"status": "success", "duration_ms": 3200, "items_processed": 42}

# Pipe-friendly
$ mycli process-file input.txt | jq '.items'
```