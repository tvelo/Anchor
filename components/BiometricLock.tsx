import * as LocalAuthentication from 'expo-local-authentication';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../lib/ThemeContext';

interface BiometricLockProps {
  children: React.ReactNode;
}

export function BiometricLock({ children }: BiometricLockProps) {
  const { colors: C } = useTheme();
  const [unlocked, setUnlocked] = useState(false);
  const [hasHardware, setHasHardware] = useState(false);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    checkDevice();
  }, []);

  async function checkDevice() {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    setHasHardware(compatible);
    if (!compatible) {
      // If hardware is not compatible, just let them in (or we could enforce pin)
      setUnlocked(true);
      return;
    }
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    setIsEnrolled(enrolled);
    if (!enrolled) {
      // If no biometrics set up, let them in natively
      setUnlocked(true);
      return;
    }
    // Attempt unlock automatically on mount
    handleUnlock();
  }

  async function handleUnlock() {
    try {
      setErrorMsg('');
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock your Private Spaces',
        fallbackLabel: 'Use Passcode',
        disableDeviceFallback: false,
      });

      if (result.success) {
        setUnlocked(true);
      } else {
        // user canceled or failed
        setErrorMsg('Authentication failed. Tap to try again.');
      }
    } catch (err: any) {
      setErrorMsg('Biometrics error: ' + err.message);
    }
  }

  if (unlocked) {
    return <>{children}</>;
  }

  return (
    <View style={[styles.container, { backgroundColor: C.bg }]}>
      <Text style={styles.icon}>🔒</Text>
      <Text style={[styles.title, { color: C.textPrimary }]}>Locked Space</Text>
      <Text style={[styles.subtitle, { color: C.textSecondary }]}>
        Use Face ID or Touch ID to access your private memories.
      </Text>

      {!!errorMsg && (
        <Text style={[styles.error, { color: C.danger }]}>{errorMsg}</Text>
      )}

      {hasHardware && isEnrolled && (
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: C.accent }]}
          onPress={handleUnlock}
        >
          <Text style={[styles.btnText, { color: C.bg }]}>Unlock</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  icon: {
    fontSize: 54,
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    fontFamily: 'Georgia',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
    maxWidth: 280,
  },
  error: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 24,
  },
  btn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 24,
  },
  btnText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
