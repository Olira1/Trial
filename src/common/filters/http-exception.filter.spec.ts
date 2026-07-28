import assert from 'node:assert';
import {
  ArgumentsHost,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { z, ZodError } from 'zod';
import { AllExceptionsFilter } from './http-exception.filter';

type ErrorBody = {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
};

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock<unknown, [ErrorBody]>;
};

const firstBody = (res: MockResponse): ErrorBody => {
  const call = res.json.mock.calls[0];
  assert(call, 'expected json to have been called');
  return call[0];
};

const buildHost = (
  url = '/v1/test',
): { host: ArgumentsHost; res: MockResponse } => {
  const res: MockResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn<unknown, [ErrorBody]>(),
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ url }),
    }),
  } as unknown as ArgumentsHost;
  return { host, res };
};

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('maps ZodError to 400 with per-issue messages', () => {
    const { host, res } = buildHost();
    const err = (() => {
      try {
        z.object({ phone: z.string() }).parse({});
        throw new Error('schema unexpectedly accepted bad input');
      } catch (e) {
        return e as ZodError;
      }
    })();

    filter.catch(err, host);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = firstBody(res);
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('ValidationError');
    expect(Array.isArray(body.message)).toBe(true);
    expect(body.message[0]).toMatch(/phone/);
    expect(body.path).toBe('/v1/test');
    expect(body.timestamp).toEqual(expect.any(String));
  });

  it('maps HttpException with string message to its status', () => {
    const { host, res } = buildHost();
    filter.catch(new NotFoundException('user not found'), host);

    expect(res.status).toHaveBeenCalledWith(404);
    const body = firstBody(res);
    expect(body.statusCode).toBe(404);
    expect(body.message).toBe('user not found');
  });

  it('preserves message arrays from HttpException object responses', () => {
    const { host, res } = buildHost();
    filter.catch(
      new BadRequestException({
        message: ['phone is invalid', 'name required'],
      }),
      host,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    const body = firstBody(res);
    expect(body.message).toEqual(['phone is invalid', 'name required']);
  });

  it('maps unknown errors to a generic 500', () => {
    const { host, res } = buildHost();
    filter.catch(new Error('boom'), host);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = firstBody(res);
    expect(body.statusCode).toBe(500);
    expect(body.error).toBe('InternalServerError');
    expect(body.message).toBe('Something went wrong');
  });

  it('maps non-Error throwables to 500 too', () => {
    const { host, res } = buildHost();
    filter.catch('string thrown', host);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
