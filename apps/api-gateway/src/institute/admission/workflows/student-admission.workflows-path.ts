/** Where the worker bundles the admission workflow from; a function so tests can replace it. */
export function studentAdmissionWorkflowsPath(): string {
  return require.resolve('./student-admission.workflow');
}
