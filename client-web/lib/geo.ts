/** Single-shot geolocation. Returns ``null`` if the user denies or the
 * device has no GPS. We deliberately don't ``watchPosition`` — check-in is
 * a one-shot interaction and a continuous watcher drains the battery. */
export async function getCurrentPosition(): Promise<GeolocationPosition | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 15_000 }
    );
  });
}
