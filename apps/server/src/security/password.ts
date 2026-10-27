import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const MAX_MEMORY = 64 * 1024 * 1024;
const ALGORITHM = "scrypt";

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  params: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      { ...params, maxmem: MAX_MEMORY },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = await deriveKey(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  return [
    ALGORITHM,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");

  if (parts.length !== 6 || parts[0] !== ALGORITHM) {
    return false;
  }

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltPart = parts[4];
  const hashPart = parts[5];

  if (
    !Number.isInteger(n) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    n < 2 ||
    n > 1_048_576 ||
    r < 1 ||
    r > 32 ||
    p < 1 ||
    p > 16 ||
    saltPart === undefined ||
    hashPart === undefined
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(saltPart, "base64url");
    const expected = Buffer.from(hashPart, "base64url");

    if (salt.length !== SALT_LENGTH || expected.length !== KEY_LENGTH) {
      return false;
    }

    const actual = await deriveKey(password, salt, expected.length, { N: n, r, p });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
