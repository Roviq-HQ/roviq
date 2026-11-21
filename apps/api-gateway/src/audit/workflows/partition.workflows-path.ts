/** Where the worker bundles the partition workflow from; a function so tests can replace it. */
export function auditPartitionWorkflowsPath(): string {
  return require.resolve('./partition.workflow');
}
