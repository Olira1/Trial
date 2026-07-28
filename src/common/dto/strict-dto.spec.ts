import { z, ZodError } from 'zod';
import { createStrictDto } from './strict-dto';

describe('createStrictDto', () => {
  const Login = createStrictDto(z.object({ phone: z.string() }));

  it('accepts a body that exactly matches the schema', () => {
    expect(Login.schema.parse({ phone: '+251' })).toEqual({ phone: '+251' });
  });

  it('rejects bodies with extra unknown keys instead of stripping them', () => {
    expect(() => Login.schema.parse({ phone: '+251', isAdmin: true })).toThrow(
      ZodError,
    );
  });

  it('still surfaces normal validation errors', () => {
    expect(() => Login.schema.parse({})).toThrow(ZodError);
  });
});
