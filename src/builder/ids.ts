// Stable nanoid generator used for instance/style/breakpoint IDs.
// Alphabet kept ASCII-letter-digit only to stay safe inside CSS class names and JS identifiers.

import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 12);

export function newId(): string {
  return nanoid();
}
