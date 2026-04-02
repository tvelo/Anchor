import * as Haptics from 'expo-haptics'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import SpaceCanvas from '../../components/SpaceCanvas'
import { useBiometricSetting } from '../../lib/useBiometricSetting'

export default function SpaceDetail() {
  const params = useLocalSearchParams()
  const router = useRouter()
  const { prompt: biometricPrompt } = useBiometricSetting()
  const spaceId = params.id as string

  useEffect(() => {
    const checkAccess = async () => {
      const ok = await biometricPrompt()
      if (!ok) {
        router.back()
        return
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    }
    checkAccess()
  }, [])

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <SpaceCanvas 
        spaceId={spaceId} 
        onBack={() => router.back()}
      />
    </SafeAreaView>
  )
}
