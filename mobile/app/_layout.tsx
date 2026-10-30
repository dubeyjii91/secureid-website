import { useEffect } from "react";
import { AppState } from "react-native";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { isBiometricLockEnabled, lockBiometricSession } from "../src/biometric";

export default function RootLayout() {
  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (previousState === "active" && nextState !== "active") {
        lockBiometricSession();
      }
      if (previousState !== "active" && nextState === "active") {
        void isBiometricLockEnabled().then((enabled) => {
          if (enabled) router.replace("/locked");
        });
      }
      previousState = nextState;
    });
    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#07111f" },
          animation: "fade",
        }}
      />
    </SafeAreaProvider>
  );
}
