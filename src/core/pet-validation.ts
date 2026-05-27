import { validateSheetDimensions } from './sprite-format'

export interface PetManifest {
  id: string
  displayName: string
  description: string
  spritesheetPath: string
}

export type ValidationResult =
  | { ok: true; pet: PetManifest }
  | { ok: false; errors: string[] }

export interface SheetMeta {
  width: number
  height: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function validatePet(raw: unknown, sheet: SheetMeta): ValidationResult {
  const errors: string[] = []

  if (!isRecord(raw)) {
    return { ok: false, errors: ['pet.json 不是物件'] }
  }

  const id = raw.id
  const spritesheetPath = raw.spritesheetPath

  if (typeof id !== 'string' || id.length === 0) errors.push('缺少 id')
  if (typeof spritesheetPath !== 'string' || spritesheetPath.length === 0) {
    errors.push('缺少 spritesheetPath')
  }
  if (!validateSheetDimensions(sheet.width, sheet.height)) {
    errors.push(`精靈表尺寸不符（需 1536×1872，實際 ${sheet.width}×${sheet.height}）`)
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    pet: {
      id: id as string,
      displayName: typeof raw.displayName === 'string' ? raw.displayName : (id as string),
      description: typeof raw.description === 'string' ? raw.description : '',
      spritesheetPath: spritesheetPath as string,
    },
  }
}
