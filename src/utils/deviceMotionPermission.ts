let isPermissionGranted = false;

/**
 * Xin quyền cảm biến chuyển động trên thiết bị di động (đặc biệt là iOS 13+ Safari).
 * Bắt buộc phải được gọi trực tiếp trong ngữ cảnh sự kiện tương tác người dùng (click, touchend, pointerup).
 * Chỉ đánh dấu đã cấp quyền KHI trình duyệt thực sự trả về 'granted' (không khóa cứng nếu thất bại do gesture không hợp lệ).
 */
export async function requestDeviceMotionPermission(): Promise<boolean> {
  if (isPermissionGranted) {
    return true;
  }

  // 1. Xin quyền DeviceMotionEvent trên iOS 13+
  if (
    typeof DeviceMotionEvent !== 'undefined' &&
    typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function'
  ) {
    try {
      const response = await (
        DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }
      ).requestPermission();
      if (response === 'granted') {
        isPermissionGranted = true;
      }
    } catch {
      // Bỏ qua lỗi để cú chạm sau vẫn có thể gọi lại
    }

    // 2. Xin quyền DeviceOrientationEvent nếu có trên thiết bị iOS
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function'
    ) {
      try {
        await (
          DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }
        ).requestPermission();
      } catch {
        // Bỏ qua lỗi
      }
    }

    return isPermissionGranted;
  }

  // Trên Android / Desktop không cần gọi requestPermission
  isPermissionGranted = true;
  return true;
}

/**
 * Gắn listener toàn cục để xin quyền cảm biến chuyển động ngay ở lần tương tác đầu tiên của người dùng,
 * sau đó tự động gỡ bỏ listener khi quyền đã được cấp.
 */
export function setupEarlyMotionPermission(): () => void {
  if (isPermissionGranted || typeof window === 'undefined') {
    return () => {};
  }

  const events: (keyof WindowEventMap)[] = ['click', 'touchend', 'pointerup'];

  const handleFirstInteraction = () => {
    void requestDeviceMotionPermission().then((granted) => {
      if (granted) {
        cleanup();
      }
    });
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
