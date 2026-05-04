import * as Location from "expo-location";
import { useCallback, useEffect, useState } from "react";

interface State {
  status: "idle" | "checking" | "granted" | "denied";
  position?: { latitude: number; longitude: number; accuracy: number | null };
  error?: string;
}

export function useLocation() {
  const [state, setState] = useState<State>({ status: "idle" });

  const request = useCallback(async () => {
    setState({ status: "checking" });
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setState({ status: "denied", error: "permission_denied" });
      return false;
    }
    setState({ status: "granted" });
    return true;
  }, []);

  const getOnce = useCallback(async () => {
    const ok = state.status === "granted" || (await request());
    if (!ok) return null;
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const next = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
      };
      setState({ status: "granted", position: next });
      return next;
    } catch (e) {
      setState({ status: "denied", error: (e as Error).message });
      return null;
    }
  }, [state.status, request]);

  useEffect(() => {
    void request();
  }, [request]);

  return { ...state, getOnce, request };
}
