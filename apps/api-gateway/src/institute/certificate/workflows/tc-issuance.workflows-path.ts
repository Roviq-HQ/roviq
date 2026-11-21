/** Where the worker bundles the TC workflow from; a function so tests can replace it. */
export function tcIssuanceWorkflowsPath(): string {
  return require.resolve('./tc-issuance.workflow');
}
