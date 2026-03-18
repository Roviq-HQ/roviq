import { type Type } from '@nestjs/common';
import { Field, Int, ObjectType } from '@nestjs/graphql';
import { PageInfo } from '@roviq/nestjs-graphql';

/**
 * Creates a Relay-style Connection type for the given node type.
 * Usage: `const InstituteConnection = createConnectionType(InstituteModel, 'Institute');`
 */
export function createConnectionType<T>(nodeType: Type<T>, name: string) {
  @ObjectType(`${name}Edge`)
  class EdgeType {
    @Field(() => nodeType)
    node!: T;

    @Field()
    cursor!: string;
  }

  @ObjectType(`${name}Connection`)
  class ConnectionType {
    @Field(() => [EdgeType])
    edges!: EdgeType[];

    @Field(() => PageInfo)
    pageInfo!: PageInfo;

    @Field(() => Int)
    totalCount!: number;
  }

  return { ConnectionType, EdgeType };
}

/** Encode a cursor from an object */
export function encodeCursor(data: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

/** Decode a cursor to an object */
export function decodeCursor(cursor: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
}
