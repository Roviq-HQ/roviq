/** Where the worker bundles the notification workflows from; a function so tests can replace it. */
export function notificationWorkflowsPath(): string {
  return require.resolve('./notification.workflows');
}
