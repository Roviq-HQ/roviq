import * as Types from '@roviq/graphql/generated';

import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type InstituteLocalesQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type InstituteLocalesQuery = { __typename?: 'Query', myInstitute: { __typename?: 'InstituteModel', id: string, supportedLocales: Array<string>, defaultLocale: string } };


export const InstituteLocalesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"InstituteLocales"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myInstitute"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"supportedLocales"}},{"kind":"Field","name":{"kind":"Name","value":"defaultLocale"}}]}}]}}]} as unknown as DocumentNode<InstituteLocalesQuery, InstituteLocalesQueryVariables>;