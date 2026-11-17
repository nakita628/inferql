# Changesets

For a pull request with a user-visible change, run `pnpm changeset` and add the file it writes to
this directory: the packages it affects (`inferql` / `vscode-inferql`), the bump for each (patch /
minor / major) and a summary of the change.

At release time, `pnpm changeset:version` turns the files collected here into the new `version` in
each package's `package.json` and an entry in its `CHANGELOG.md`. See
[Changesets](https://github.com/changesets/changesets) for details.

On `main`, the Release workflow (`.github/workflows/release.yml`) does this for you: it opens a
"Version Packages" pull request while changesets are pending, and once that is merged it publishes
`inferql` to npm and `vscode-inferql` to the VS Code Marketplace, both through OIDC trusted
publishing.
