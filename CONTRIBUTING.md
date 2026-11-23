# Contributing to Roviq

## Set up

Follow [docs/getting-started.md](docs/getting-started.md). One command (`pnpm tilt up`) starts the
databases, the migrations, the seeds and the apps.

## Make a change

1. Pick an issue, or open one that describes the change. Work is tracked in Linear and mirrored to
   [GitHub Issues](https://github.com/Roviq-HQ/roviq/issues).
2. Branch from `main`.
3. Write the change with its tests. [docs/testing.md](docs/testing.md) says which test type covers
   what and how to run it.
4. Update the documentation in the same change. The rules are in
   [docs/README.md](docs/README.md#writing-docs).
5. Run `pnpm lint:fix`.
6. Commit with a [Conventional Commits](https://www.conventionalcommits.org/) message, header at
   most 100 characters: `feat(attendance): mark a whole section present`.
7. Push. The pre-push hook runs `pnpm ci:check`, the same gate as CI; a push that fails it does not
   leave your machine.
8. Open a pull request against `main` that names the issue.

## Conventions

The project rules (naming, tenant isolation, authorization, testing, the checks a change must pass)
are in [CLAUDE.md](CLAUDE.md). They are written for coding agents and apply to everyone.

## Licence

The code outside `ee/` is licensed under [AGPL-3.0](LICENSE). The code in `ee/` has its own
[licence](ee/LICENSE). By contributing you agree that your contribution is licensed the same way as
the directory it is in.
