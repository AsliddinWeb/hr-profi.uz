import { Link, Stack } from "expo-router";
import { Text, View } from "react-native";

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View className="flex-1 items-center justify-center bg-slate-50 p-6">
        <Text className="mb-4 text-lg font-semibold">This screen doesn't exist.</Text>
        <Link href="/(tabs)/home" className="text-brand-600">
          Go home
        </Link>
      </View>
    </>
  );
}
