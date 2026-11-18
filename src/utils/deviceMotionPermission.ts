let hasRequestedPermission = false;
let isPermissionGranted = false;

/**
 * Xin quyền cảm biến chuyển động trên thiết bị di động (đặc biệt là iOS 13+).
 * Bắt buộc phải được gọi trực tiếp trong ngữ cảnh sự kiện tương tác người dùng (click, pointerup, touchend).
 * Chỉ gọi tối đa 1 lần trong suốt phiên dùng để tránh làm gián đoạn trải nghiệm người dùng.
 */
export async function requestDeviceMotionPermission(): Promise<boolean> {
  if (hasRequestedPermission) {
    return isPermissionGranted;
  }

  if (
    typeof DeviceMotionEvent !== 'undefined' &&
    typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function'
  ) {
    hasRequestedPermission = true;
    try {
      const response = await (
        DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }
      ).requestPermission();
      isPermissionGranted = response === 'granted';
      return isPermissionGranted;
    } catch {
      isPermissionGranted = false;
      return false;
    }
  }

  // Trên Android / desktop không cần xin quyền qua requestPermission
  hasRequestedPermission = true;
  isPermissionGranted = true;
  return true;
}

/**
 * Gắn listener toàn cục để xin quyền cảm biến chuyển động ngay ở lần tương tác đầu tiên của người dùng,
 * sau đó tự động gỡ bỏ listener để không lặp lại.
 */
export function setupEarlyMotionPermission(): () => void {
  if (hasRequestedPermission || typeof window === 'undefined') {
    return () => {};
  }

  const events: (keyof WindowEventMap)[] = ['click', 'touchend', 'pointerup'];

  const handleFirstInteraction = () => {
    cleanup();
    void requestDeviceMotionPermission();
  };

  const cleanup = () => {
    events.forEach((evt) => {
      window.removeEventListener(evt, handleFirstInteraction);
    });
  };

  events.forEach((evt) => {
    window.addEventListener(evt, handleFirstInteraction, { passive: true });
  });

  return cleanup;
}
