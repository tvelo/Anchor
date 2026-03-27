import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'
import { AudioManagerProvider, useAudioManager } from '../../lib/AudioManager'

// Suppress react-test-renderer deprecation warning
const origError = console.error
beforeAll(() => {
  console.error = (...args: any[]) => {
    if (/react-test-renderer is deprecated/.test(String(args[0]))) return
    origError(...args)
  }
})
afterAll(() => { console.error = origError })

let captured: ReturnType<typeof useAudioManager>

function TestConsumer() {
  captured = useAudioManager()
  return <Text>{captured.getActiveId() ?? 'none'}</Text>
}

describe('AudioManager', () => {
  it('provides null as default activeId', () => {
    act(() => {
      renderer.create(
        <AudioManagerProvider><TestConsumer /></AudioManagerProvider>
      )
    })
    expect(captured.getActiveId()).toBeNull()
  })

  it('allows setting and getting activeId', () => {
    act(() => {
      renderer.create(
        <AudioManagerProvider><TestConsumer /></AudioManagerProvider>
      )
    })
    act(() => { captured.setActiveId('song-1') })
    expect(captured.getActiveId()).toBe('song-1')
  })

  it('allows clearing activeId', () => {
    act(() => {
      renderer.create(
        <AudioManagerProvider><TestConsumer /></AudioManagerProvider>
      )
    })
    act(() => { captured.setActiveId('song-1') })
    act(() => { captured.setActiveId(null) })
    expect(captured.getActiveId()).toBeNull()
  })

  it('returns noop defaults without provider', () => {
    act(() => { renderer.create(<TestConsumer />) })
    expect(captured.getActiveId()).toBeNull()
    // should not throw
    act(() => { captured.setActiveId('test') })
  })
})
