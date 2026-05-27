import { describe, it, expect } from 'vitest'
import { validatePet } from '../../src/core/pet-validation'

const goodSheet = { width: 1536, height: 1872 }

describe('validatePet', () => {
  it('accepts a well-formed pet with a canonical sheet', () => {
    const result = validatePet(
      { id: 'may', displayName: 'may', description: 'a dog', spritesheetPath: 'spritesheet.webp' },
      goodSheet,
    )
    expect(result).toEqual({
      ok: true,
      pet: { id: 'may', displayName: 'may', description: 'a dog', spritesheetPath: 'spritesheet.webp' },
    })
  })

  it('defaults displayName to id and description to empty string', () => {
    const result = validatePet({ id: 'may', spritesheetPath: 'spritesheet.webp' }, goodSheet)
    expect(result).toEqual({
      ok: true,
      pet: { id: 'may', displayName: 'may', description: '', spritesheetPath: 'spritesheet.webp' },
    })
  })

  it('rejects a sheet with the wrong dimensions', () => {
    const result = validatePet(
      { id: 'may', spritesheetPath: 'spritesheet.webp' },
      { width: 800, height: 600 },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('尺寸'))).toBe(true)
    }
  })

  it('rejects missing id / spritesheetPath', () => {
    const result = validatePet({ displayName: 'x' }, goodSheet)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContain('缺少 id')
      expect(result.errors).toContain('缺少 spritesheetPath')
    }
  })

  it('rejects non-object input', () => {
    const result = validatePet(null, goodSheet)
    expect(result.ok).toBe(false)
  })
})
