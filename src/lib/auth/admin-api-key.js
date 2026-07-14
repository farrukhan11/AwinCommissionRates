import { timingSafeEqual } from "node:crypto";

export function isValidAdminApiKey(providedKey) {
  const expectedKey = process.env.ADMIN_API_KEY;

  if (!expectedKey || !providedKey) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedKey);
  const providedBuffer = Buffer.from(providedKey);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
