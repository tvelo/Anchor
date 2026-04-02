import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'anchor_biometric_lock_enabled';

/**
 * Hook for reading/writing the biometric lock preference.
 * Returns:
 *   - isEnabled: whether the user has turned on biometric lock
 *   - setEnabled: toggle the setting on/off
 *   - prompt: call this to run a biometric check; resolves true if passed/not needed
 */
export function useBiometricSetting() {
  const [isEnabled, setIsEnabledState] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(val => {
      setIsEnabledState(val === 'true');
      setLoaded(true);
    });
  }, []);

  const setEnabled = useCallback(async (val: boolean) => {
    setIsEnabledState(val);
    await AsyncStorage.setItem(STORAGE_KEY, val ? 'true' : 'false');
  }, []);

  /**
   * Run biometric prompt if setting is enabled.
   * Returns true if user is allowed through (either lock off, no hardware, or auth passed).
   */
  const prompt = useCallback(async (): Promise<boolean> => {
    if (!isEnabled) return true;

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return true;

    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (!isEnrolled) return true;

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock your private content',
      fallbackLabel: 'Use Passcode',
      disableDeviceFallback: false,
    });

    return result.success;
  }, [isEnabled]);

  return { isEnabled, setEnabled, prompt, loaded };
}
