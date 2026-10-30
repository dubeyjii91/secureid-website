import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";

const BIOMETRIC_LOCK_KEY = "secureid.native.biometric-lock.v1";
let unlockedInProcess = false;

export async function isBiometricLockEnabled() {
  return (await SecureStore.getItemAsync(BIOMETRIC_LOCK_KEY)) === "true";
}

export async function enableBiometricLock() {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!hasHardware || !enrolled) {
    throw new Error("Set up fingerprint or face unlock in Android settings before enabling biometric app lock.");
  }
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Enable SecureID biometric app lock",
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
  });
  if (!result.success) return false;
  await SecureStore.setItemAsync(BIOMETRIC_LOCK_KEY, "true", {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  unlockedInProcess = true;
  return true;
}

export async function disableBiometricLock() {
  const enabled = await isBiometricLockEnabled();
  if (!enabled) return true;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Confirm to disable SecureID biometric app lock",
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
  });
  if (!result.success) return false;
  await SecureStore.deleteItemAsync(BIOMETRIC_LOCK_KEY);
  unlockedInProcess = true;
  return true;
}

export async function requireBiometricUnlock() {
  if (!(await isBiometricLockEnabled())) return true;
  if (unlockedInProcess) return true;
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!hasHardware || !enrolled) return false;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock SecureID",
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
  });
  unlockedInProcess = result.success;
  return result.success;
}

export function lockBiometricSession() {
  unlockedInProcess = false;
}

export async function clearBiometricLock() {
  await SecureStore.deleteItemAsync(BIOMETRIC_LOCK_KEY);
  unlockedInProcess = false;
}
