import * as Types from '@roviq/graphql/generated';

import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type UpdateInstituteLocalesMutationVariables = Types.Exact<{
  input: Types.UpdateInstituteLocalesInput;
}>;


export type UpdateInstituteLocalesMutation = { __typename?: 'Mutation', updateInstituteLocales: { __typename?: 'InstituteModel', id: string, supportedLocales: Array<string>, defaultLocale: string, version: number } };


export const UpdateInstituteLocalesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateInstituteLocales"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateInstituteLocalesInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateInstituteLocales"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"supportedLocales"}},{"kind":"Field","name":{"kind":"Name","value":"defaultLocale"}},{"kind":"Field","name":{"kind":"Name","value":"version"}}]}}]}}]} as unknown as DocumentNode<UpdateInstituteLocalesMutation, UpdateInstituteLocalesMutationVariables>;