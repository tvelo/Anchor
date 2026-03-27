import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'
import { ErrorBoundary } from '../../components/ErrorBoundary'

// Suppress error boundary + deprecation console.error
const origError = console.error
beforeAll(() => {
  console.error = (...args: any[]) => {
    const msg = String(args[0])
    if (/react-test-renderer is deprecated|ErrorBoundary|Test crash|above error/.test(msg)) return
    origError(...args)
  }
})
afterAll(() => { console.error = origError })

function ThrowOnMount({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test crash')
  return <Text>All good</Text>
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    let tree: renderer.ReactTestRenderer
    act(() => { tree = renderer.create(
      <ErrorBoundary><Text>Child content</Text></ErrorBoundary>
    )})
    const json = JSON.stringify(tree!.toJSON())
    expect(json).toContain('Child content')
  })

  it('renders fallback UI on error', () => {
    let tree: renderer.ReactTestRenderer
    act(() => { tree = renderer.create(
      <ErrorBoundary><ThrowOnMount shouldThrow={true} /></ErrorBoundary>
    )})
    const json = JSON.stringify(tree!.toJSON())
    expect(json).toContain('This item failed to load')
    expect(json).toContain('Retry')
  })

  it('renders custom fallback when provided', () => {
    let tree: renderer.ReactTestRenderer
    act(() => { tree = renderer.create(
      <ErrorBoundary fallback={<Text>Custom error</Text>}>
        <ThrowOnMount shouldThrow={true} />
      </ErrorBoundary>
    )})
    const json = JSON.stringify(tree!.toJSON())
    expect(json).toContain('Custom error')
    expect(json).not.toContain('Retry')
  })

  it('calls onReset when Retry is pressed', () => {
    const onReset = jest.fn()
    let tree: renderer.ReactTestRenderer
    act(() => { tree = renderer.create(
      <ErrorBoundary onReset={onReset}>
        <ThrowOnMount shouldThrow={true} />
      </ErrorBoundary>
    )})
    const retryBtn = tree!.root.findByProps({ accessibilityLabel: 'Retry loading' })
    act(() => { retryBtn.props.onPress() })
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('has accessible retry button with correct role', () => {
    let tree: renderer.ReactTestRenderer
    act(() => { tree = renderer.create(
      <ErrorBoundary><ThrowOnMount shouldThrow={true} /></ErrorBoundary>
    )})
    const retryBtn = tree!.root.findByProps({ accessibilityRole: 'button' })
    expect(retryBtn.props.accessibilityLabel).toBe('Retry loading')
  })
})
