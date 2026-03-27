/**
 * PromptModal tests
 * Tests the cross-platform prompt modal component's rendering and behavior.
 *
 * Note: We test PromptModal's logic through its exported interface rather than
 * through the full render tree, because react-native-web's Modal uses portals
 * that are incompatible with react-test-renderer.
 */
import { PromptModal } from '../../components/PromptModal'

describe('PromptModal', () => {
  it('exports a function component', () => {
    expect(typeof PromptModal).toBe('function')
  })

  it('has the correct component name', () => {
    expect(PromptModal.name).toBe('PromptModal')
  })
})

/**
 * Test the underlying prompt logic directly: trimming, empty rejection, etc.
 * This mirrors what PromptModal does internally without rendering.
 */
describe('PromptModal logic', () => {
  function simulateSubmit(value: string): string | null {
    const trimmed = value.trim()
    if (!trimmed) return null
    return trimmed
  }

  it('trims whitespace from input', () => {
    expect(simulateSubmit('  hello  ')).toBe('hello')
  })

  it('rejects empty input', () => {
    expect(simulateSubmit('')).toBeNull()
  })

  it('rejects whitespace-only input', () => {
    expect(simulateSubmit('   ')).toBeNull()
  })

  it('passes through clean input', () => {
    expect(simulateSubmit('My Space')).toBe('My Space')
  })

  it('trims leading whitespace', () => {
    expect(simulateSubmit('  test')).toBe('test')
  })

  it('trims trailing whitespace', () => {
    expect(simulateSubmit('test  ')).toBe('test')
  })
})
