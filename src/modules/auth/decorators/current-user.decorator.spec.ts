import assert from 'node:assert';
import { Controller, ExecutionContext, Get, UseGuards } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { User } from '../../user';
import { CurrentUser } from './current-user.decorator';

const callDecorator = (ctx: ExecutionContext) => {
  @Controller()
  class Probe {
    @Get('/')
    @UseGuards()
    handler(@CurrentUser() user: User) {
      return user;
    }
  }
  const args = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    Probe,
    'handler',
  ) as Record<
    string,
    { factory: (data: unknown, ctx: ExecutionContext) => unknown }
  >;
  const [first] = Object.values(args);
  assert(first, 'expected decorator args to be registered');
  return first.factory(undefined, ctx);
};

describe('@CurrentUser decorator', () => {
  it('returns the user attached to the request', () => {
    const user = { id: 'u1', firstName: 'A', lastName: 'B' } as User;
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
    expect(callDecorator(ctx)).toBe(user);
  });
});
