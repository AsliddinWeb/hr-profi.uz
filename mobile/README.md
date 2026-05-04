# WORKTIME PRO — Mobile (Expo)

Xodim mobil ilovasi: login → bosh sahifa CHECK-IN/OUT bilan → real-time
oylik tickeri → smenalar / KPI / profil.

## Stack

- Expo SDK 51 + expo-router (file-based)
- TypeScript, NativeWind 4 (Tailwind-for-RN), TanStack Query, Zustand, axios
- i18next (uz / ru / en) — saqlanadi `AsyncStorage`'da
- expo-location (GPS), expo-haptics (CHECK-IN haptic feedback)

## Birinchi marta ishga tushirish

```bash
cd mobile
npm install --legacy-peer-deps
npx expo start
```

Konsol QR kod chiqaradi:
- **iOS / Android telefon** — Expo Go ilovasini Apple Store / Google Play'dan
  yuklab olib, QR'ni skanerlang.
- **Brauzer** — `w` bosing (preview).
- **iOS simulator / Android emulator** — `i` yoki `a`.

## API URL'i sozlash

`mobile/app.json` ichida `extra.apiUrl` va `extra.wsUrl` bor. **LAN'dagi
telefon uchun localhost ishlamaydi** — kompyuteringizning LAN IP'sini qoying:

```json
"extra": {
  "apiUrl": "http://192.168.1.42:8000/api/v1",
  "wsUrl": "ws://192.168.1.42:8000/ws"
}
```

Yoki environment orqali (EAS Build uchun afzal):

```bash
EXPO_PUBLIC_API_URL=https://api.worktimepro.uz/api/v1 \
EXPO_PUBLIC_WS_URL=wss://api.worktimepro.uz/ws \
npx expo start
```

LAN IP'ni topish: `ipconfig getifaddr en0` (mac) yoki `hostname -I` (linux).

## Test foydalanuvchisi

Backend tomondagi seed va smoke testlardan keyin tayyor xodim:

- **username:** `vali`
- **parol:** `EmpPass123!`

Bu xodimning CHECK-IN'lari va oyligi backend'da real ko'rinadi (Phase 3
salary recompute Celery worker orqali).

## Ekranlar

| Yo'l | Ekran |
|------|-------|
| `(auth)/login` | Login (username/parol + til selektor) |
| `(tabs)/home` | Bosh sahifa: smena, CHECK-IN/OUT katta tugma, bugun/oyda topgan |
| `(tabs)/salary` | Bugungi taqsimot, joriy oy, tarix |
| `(tabs)/shifts` | Kelgusi smenalar |
| `(tabs)/kpi` | Joriy oy KPI'lari (score + reward) |
| `(tabs)/profile` | Ma'lumotlar, til o'zgartirish, chiqish |

## Geofence va selfie

- Phase 2 mobil flow: `expo-location` ruxsatini so'raydi va GPS coords'ni
  CHECK-IN/OUT body'ga jo'natadi. Backend Haversine bilan `branch.geofence_radius_m`
  ichida ekanini tekshiradi va `status = SUSPICIOUS` qiladi agar tashqarida bo'lsa.
- Selfie — Phase 4 (`expo-camera` + face match score). Hozir backend `selfie_url=null`
  qabul qiladi.

## Build (production)

```bash
# iOS
eas build --platform ios --profile production

# Android (.aab)
eas build --platform android --profile production
```

`eas.json` profillarida `EXPO_PUBLIC_API_URL` va `EXPO_PUBLIC_WS_URL` build
vaqtida bake qilinadi.

## Topology

```
mobile/
├── app/                    # expo-router file-based routes
│   ├── _layout.tsx         # Root: QueryClient + AuthGate + i18n
│   ├── index.tsx           # Redirect by auth state
│   ├── (auth)/login.tsx
│   └── (tabs)/             # Bottom tabs (home, salary, shifts, kpi, profile)
├── src/
│   ├── api/client.ts       # axios + refresh interceptor (single-flight)
│   ├── stores/auth.ts      # Zustand + AsyncStorage persist
│   ├── components/         # Button, Card, StatBlock
│   ├── hooks/useLocation.ts
│   ├── lib/                # types, format, env
│   ├── locales/{uz,ru,en}.json
│   └── i18n.ts
├── assets/                 # icons, splash (placeholders)
├── app.json                # Expo config (perms, build args)
├── eas.json                # EAS Build profiles
├── babel.config.js         # nativewind preset + reanimated plugin
├── metro.config.js         # withNativeWind
├── tailwind.config.js
├── global.css
└── tsconfig.json
```
