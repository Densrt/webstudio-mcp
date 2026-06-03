// Shared 21-char URL-safe nanoid generators — Webstudio convention.

import { customAlphabet } from "nanoid";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export const wsId = customAlphabet(ALPHABET, 21);
export const txId = customAlphabet(ALPHABET, 21);
