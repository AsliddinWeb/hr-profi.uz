import { ActivityIndicator, Pressable, Text, type PressableProps } from "react-native";

type Variant = "primary" | "secondary" | "danger" | "success";

interface Props extends PressableProps {
  variant?: Variant;
  loading?: boolean;
  size?: "default" | "lg";
  children: React.ReactNode;
}

const baseClass: Record<Variant, { box: string; text: string }> = {
  primary: { box: "bg-brand-600 active:bg-brand-700", text: "text-white" },
  secondary: { box: "bg-slate-100 active:bg-slate-200", text: "text-slate-900" },
  danger: { box: "bg-red-600 active:bg-red-700", text: "text-white" },
  success: { box: "bg-emerald-600 active:bg-emerald-700", text: "text-white" },
};

export function Button({
  variant = "primary",
  loading = false,
  disabled,
  size = "default",
  children,
  ...rest
}: Props) {
  const v = baseClass[variant];
  const disabledClass = disabled || loading ? "opacity-50" : "";
  const padding = size === "lg" ? "py-4 px-6" : "py-3 px-5";
  return (
    <Pressable
      disabled={disabled || loading}
      className={`flex-row items-center justify-center rounded-xl ${padding} ${v.box} ${disabledClass}`}
      {...rest}
    >
      {loading ? <ActivityIndicator color={variant === "secondary" ? "#0f172a" : "#fff"} /> : null}
      <Text
        className={`${v.text} ${size === "lg" ? "text-lg" : "text-base"} font-semibold ${
          loading ? "ml-2" : ""
        }`}
      >
        {children}
      </Text>
    </Pressable>
  );
}
