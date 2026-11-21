/** Where the worker bundles the setup workflow from; a function so tests can replace it. */
export function instituteSetupWorkflowsPath(): string {
  return require.resolve('./institute-setup.workflow');
}
