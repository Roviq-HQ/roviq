/** Where the worker bundles the billing workflows from; a function so tests can replace it. */
export function billingWorkflowsPath(): string {
  return require.resolve('./workflows');
}
