# Contributing to Insighta

Thank you for your interest in contributing to Insighta! This guide will help you get started.

## Getting Started

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/<your-username>/insighta.git`
3. **Install** dependencies: `npm run install:all`
4. **Set up** the database: `npx prisma generate && npx prisma db push`
5. **Create** a branch: `git checkout -b feature/your-feature`

## Development Workflow

```bash
# Run backend + frontend in dev mode
npm run dev:all

# Run tests
npm test

# Lint and type-check
npm run lint
npm run typecheck

# Build everything
npm run build:all
```

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation only
- `chore:` — Maintenance tasks
- `refactor:` — Code restructuring
- `test:` — Adding or updating tests
- `perf:` — Performance improvement

## Pull Request Process

1. Ensure `npm run build:all` passes
2. Update documentation if needed
3. Fill out the PR template
4. Request review from a maintainer

## Code Style

- TypeScript strict mode
- Prettier for formatting
- ESLint for linting
- Follow existing patterns in the codebase

## Reporting Issues

Use the [issue templates](https://github.com/JK42JJ/insighta/issues/new/choose) to report bugs or request features.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
