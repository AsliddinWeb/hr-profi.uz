import { Redirect } from "expo-router";
import { useAuthStore } from "@/stores/auth";

export default function Index() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return <Redirect href={accessToken ? "/(tabs)/home" : "/(auth)/login"} />;
}
