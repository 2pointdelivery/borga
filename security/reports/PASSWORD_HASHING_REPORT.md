# Password Hashing Security Report

## Status: PASS

## Findings

scrypt with 16-byte random salt, `saltHex:hashHex` storage, `timingSafeEqual` verify (`lib/auth/password.ts`); reset tokens random + HMAC-stored (DB dump can't reset passwords). **This pass:** pinned explicit params `{N:16384, r:8, p:1, maxmem:32MB}` (identical to Node defaults — existing hashes verify unchanged). Supporting controls intact: 200-char password cap (CPU-DoS bound), per-account lockout, dummy-hash timing equalization (69 ms vs 68 ms), production boot secret checks. No MD5/SHA-1-for-passwords (sha1 in supermemory is a non-security dedup hash).

## What's at risk

Offline cracking of a dumped user table. scrypt memory-hardness contains it.

## What's already secure

Algorithm choice, salting, constant-time compare, lockout, timing equalization.

## Recommendations

1. Consider async `scrypt` under burst load (sync blocks ~70 ms per login; throttles bound the impact today).
