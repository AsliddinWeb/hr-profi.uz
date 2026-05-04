import { View, type ViewProps } from "react-native";

export function Card({ className = "", ...rest }: ViewProps & { className?: string }) {
  return <View className={`rounded-2xl bg-white p-5 shadow-sm ${className}`} {...rest} />;
}
