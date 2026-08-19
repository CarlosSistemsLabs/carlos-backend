import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  createInfrastructureContainer,
  registerInfrastructure,
} from './composition-root.js';
import { Container, INFRASTRUCTURE_TOKENS } from './di/index.js';

// A minimal stand-in for PrismaClient; only identity matters for these tests.
const fakePrisma = { $connect: () => Promise.resolve() } as unknown as PrismaClient;

describe('registerInfrastructure', () => {
  it('registers the injected Prisma client under the PrismaClient token', () => {
    const container = new Container();

    registerInfrastructure(container, { prismaClient: fakePrisma });

    expect(container.has(INFRASTRUCTURE_TOKENS.PrismaClient)).toBe(true);
    expect(container.resolve(INFRASTRUCTURE_TOKENS.PrismaClient)).toBe(fakePrisma);
  });

  it('returns the same container instance for fluent composition', () => {
    const container = new Container();
    const result = registerInfrastructure(container, { prismaClient: fakePrisma });
    expect(result).toBe(container);
  });
});

describe('createInfrastructureContainer', () => {
  it('builds a populated container with the supplied Prisma client', () => {
    const container = createInfrastructureContainer({ prismaClient: fakePrisma });

    expect(container).toBeInstanceOf(Container);
    expect(container.resolve(INFRASTRUCTURE_TOKENS.PrismaClient)).toBe(fakePrisma);
  });
});
