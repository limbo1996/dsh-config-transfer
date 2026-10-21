/** Shared limits and identity for the dsh-config-transfer format. */
export const FORMAT = 'dsh-config-transfer'
export const FORMAT_VERSION = 1

/** Legacy format/self names accepted on import only. */
export const LEGACY_FORMAT = 'dshsync'
export const LEGACY_SELF_NAMES = new Set(['dshsync', '@limbo1996/dshsync', 'dsh-config-sync'])

export const MAX_IMPORT_BYTES = 32 * 1024 * 1024
export const MAX_EXPORT_SKILLS_BYTES = 8 * 1024 * 1024
export const MAX_SKILL_FILE_BYTES = 512 * 1024
export const MAX_SKILL_FILES = 200
export const MAX_SKILLS = 100
export const MAX_REDACTIONS = 500
