/** Where the worker bundles the export workflow from; a function so tests can replace it. */
export function complianceExportWorkflowsPath(): string {
  return require.resolve('./compliance-export.workflow');
}
