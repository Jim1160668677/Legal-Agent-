# Version Control & Release Management

## Branch Strategy (Git Flow)

```
main          ──────────────────────────────────────── Production
    │
    ├── develop      ───────────────────────────────── Development integration
    │       │
    │       ├── feature/chat-v2        Feature branches
    │       ├── feature/android-sdk    Feature branches
    │       └── fix/login-bug         Hotfix branches
    │
    └── release/v1.0  ──────────────────────── Release candidates
            │
            └── hotfix/v1.0.1   ───────────── Emergency fixes
```

### Branch Naming Conventions
- `feature/<name>` - New features
- `fix/<name>` - Bug fixes
- `release/<version>` - Release preparation
- `hotfix/<version>` - Emergency production fixes

## Semantic Versioning (SemVer 2.0)

Format: `MAJOR.MINOR.PATCH`

| Type | When to Bump | Example |
|------|-------------|---------|
| MAJOR | Breaking API changes, incompatible changes | 1.0.0 → 2.0.0 |
| MINOR | New features, backward compatible | 1.0.0 → 1.1.0 |
| PATCH | Bug fixes, backward compatible | 1.1.0 → 1.1.1 |

## Platform-Specific Versions

Each platform maintains its own version but syncs with the main SDK version:

| Platform | Version Format | Example |
|----------|---------------|---------|
| Web | `{sdk-version}-{build}` | `1.0.0-123` |
| Taro (H5) | Same as Web | `1.0.0-45` |
| WeChat MiniApp | Same as SDK | `1.0.0` |
| Android | `{sdk-version}.{build}` | `1.0.0.12` |
| iOS | `{sdk-version}.{build}` | `1.0.0.12` |
| HarmonyOS | `{sdk-version}.{build}` | `1.0.0.12` |

## Release Process

### Pre-Release Checklist
- [ ] All tests passing
- [ ] TypeScript compilation clean
- [ ] API contract verified (OpenAPI spec)
- [ ] Cross-platform UX consistency check
- [ ] Performance benchmarks pass
- [ ] Security audit passed
- [ ] Changelog updated
- [ ] Documentation updated

### Release Steps
1. Create release branch: `git checkout -b release/v1.1.0`
2. Update version numbers in all platforms
3. Run full test suite
4. Generate build artifacts
5. Create tag: `git tag -a v1.1.0 -m "Release v1.1.0"`
6. Merge to main and develop
7. Deploy to staging
8. Submit to app stores
9. Monitor post-release metrics

## Commit Message Convention

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Code style (formatting)
- `refactor`: Code refactoring
- `test`: Tests
- `chore`: Build/config tools

Examples:
```
feat(chat): add streaming response support
fix(auth): resolve token refresh race condition
docs(api): update OpenAPI spec for v1.1
test(unit): add coverage for PaymentService
chore(deploy): update CI pipeline
```