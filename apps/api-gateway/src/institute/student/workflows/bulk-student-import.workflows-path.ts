/** Where the worker bundles the import workflow from; a function so tests can replace it. */
export function bulkStudentImportWorkflowsPath(): string {
  return require.resolve('./bulk-student-import.workflow');
}
