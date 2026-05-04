import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";

export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#2563eb",
        tabBarInactiveTintColor: "#64748b",
        headerStyle: { backgroundColor: "#ffffff" },
        headerTitleStyle: { fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t("tabs.home"),
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="salary"
        options={{
          title: t("tabs.salary"),
          tabBarIcon: ({ color, size }) => <Ionicons name="cash-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="shifts"
        options={{
          title: t("tabs.shifts"),
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="kpi"
        options={{
          title: t("tabs.kpi"),
          tabBarIcon: ({ color, size }) => <Ionicons name="trophy-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("tabs.profile"),
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
