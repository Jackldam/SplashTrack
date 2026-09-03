/**
 * Cryptography entry point. Import from `@/lib/crypto`, never from the files
 * behind it — D-097 requires ONE envelope with ONE decryptor registry, and the
 * template's failure was two independent copies of the same file with different
 * HKDF labels, so a `v2` rollout would have had to happen twice, consistently,
 * with nothing enforcing it.
 *
 * WHAT A DOMAIN MODULE USES:
 *
 *   seal(columnId, primaryKey, plaintext)   → Sealed<columnId>
 *   open(columnId, primaryKey, storedValue) → plaintext, or throws
 *
 * and types its column as `Sealed<"...">` so a plaintext cannot reach it. The
 * `columnId` comes from `ENCRYPTED_COLUMNS`; it is never a literal invented at
 * the call site (`encryptedColumn` refuses an unregistered one).
 *
 * WHAT NOBODY USES: the key material. `deriveKey` is exported for the auth
 * wiring and the audit checkpoint MAC, which need a key rather than an
 * envelope. Nothing else should need it, and a new caller is a design question,
 * not a convenience.
 */

export {
  CURRENT_FORMAT,
  CURRENT_KEY_ID,
  DECRYPTORS,
  DecryptionRefusedError,
  FORMAT_VERSIONS,
  UnknownKeyIdError,
  assertSealedEnvelope,
  createKeyring,
  createProcessKeyring,
  encryptedColumnAad,
  envelopesEqual,
  isSealedEnvelope,
  keyIdOf,
  open,
  resetProcessKeyring,
  seal,
  type EnvelopeOptions,
  type FormatVersion,
  type Keyring,
  type Sealed,
} from "./envelope";

export {
  ENCRYPTED_COLUMNS,
  UnknownEncryptedColumnError,
  encryptedColumn,
  type EncryptedColumnEntry,
  type EncryptedColumnId,
  type EncryptedColumnRegistry,
} from "./encrypted-columns";

export {
  DERIVED_KEY_BYTES,
  KEY_PURPOSES,
  MissingBootstrapSecretError,
  deriveAuthSigningSecret,
  deriveKey,
  describeSecretKeySource,
  loadBootstrapSecret,
  resetBootstrapSecretCache,
  type KeyPurpose,
  type SecretKeySource,
} from "./secret-key";
