import React, { createContext, useContext, useRef, useCallback } from 'react'

interface AudioManagerValue {
  setActiveId: (id: string | null) => void
  getActiveId: () => string | null
}

const AudioManagerContext = createContext<AudioManagerValue>({
  setActiveId: () => {},
  getActiveId: () => null,
})

export function AudioManagerProvider({ children }: { children: React.ReactNode }) {
  const activeIdRef = useRef<string | null>(null)
  const setActiveId = useCallback((id: string | null) => {
    activeIdRef.current = id
  }, [])
  const getActiveId = useCallback(() => activeIdRef.current, [])
  return (
    <AudioManagerContext.Provider value={{ setActiveId, getActiveId }}>
      {children}
    </AudioManagerContext.Provider>
  )
}

export const useAudioManager = () => useContext(AudioManagerContext)
