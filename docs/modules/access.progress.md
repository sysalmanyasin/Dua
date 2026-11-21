# Access — progress

Updated: 21 November 2026  
Status: integrated foundation module on `main`.

## Implemented source

The Access manifest registers the Users & Access page. The foundation implements authentication, MFA-gated administrative permissions, role templates, per-person allow/deny permissions, owner-managed user administration and staff username/PIN login. Self-sign-up has been removed; staff accounts are created by an authorized owner.

## Live evidence

The live registry contains the staff-login PIN migration `0014_staff_logins_pin4`, but it is recorded under timestamp version `20261121032408`. The live project has six active Edge Functions, including `staff-login`, `claim-account`, `admin-users` and `request-access`.

## Remaining

- Review staff PIN lifecycle, lockout, disable and recovery procedures as a single operational workflow.
- Review the 219 authenticated-callable SECURITY DEFINER RPC findings against the actual permission checks and intended callers.
- Review leaked-password protection compatibility with the username/PIN model.
- Plan production/staging separation and repeat access tests against the eventual production project.

## Verification boundary

CI run #401 passed the configured app, database and functions jobs on main commit `9669497`. This does not replace an owner/staff sign-in acceptance test on real devices.
