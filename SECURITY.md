# Security policy

## Reporting a vulnerability

Email **security@nbb.ai**. Do not open a public issue for a security problem.

Please include:

- what the problem is and what an attacker could do with it,
- the steps to reproduce it, with the request or the code if you have it,
- the commit or the version you tested.

We will confirm that we received your report, tell you whether we can reproduce it, and keep you
informed until it is fixed. Please give us the time to release a fix before you publish the details.

## What to test against

Test on your own installation ([docs/getting-started.md](docs/getting-started.md)). Do not test
against an installation you do not own, and do not access, change or delete data that is not yours.

## Supported versions

Roviq is pre-release. Security fixes go to the `main` branch only.

## How Roviq is secured

[docs/security.md](docs/security.md) describes tenant isolation, sign-in, permissions, support
access and the audit log.
