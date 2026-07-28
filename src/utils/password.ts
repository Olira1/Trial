import { compare, hash } from 'bcrypt';

export async function hashPassword(
  plainTextPassword: string,
  saltRounds: number = 10,
) {
  return hash(plainTextPassword, saltRounds);
}

export async function verifyHash(plainTextPassword: string, hash: string) {
  return compare(plainTextPassword, hash);
}
