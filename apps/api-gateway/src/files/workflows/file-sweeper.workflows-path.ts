/** Where the worker bundles the sweeper workflow from; a function so tests can replace it. */
export function fileSweeperWorkflowsPath(): string {
  return require.resolve('./file-sweeper.workflow');
}
