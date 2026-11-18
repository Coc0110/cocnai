let isPermissionGranted = false;

/**
 * Xin quyền cảm biến chuyển động trên thiết bị di động (đặc biệt là iOS 13+).
 * Bắt buộc phải được gọi trực tiếp trong ngữ cảnh sự kiện tương tác người dùng (click, pointerup, touchend).
 */
export async function requestDeviceMotionPermission(): Promise<boolean> {
  if (isPermissionGranted) return true;

  if (
    typeof DeviceMotionEvent !== 'undefined' &&
    typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function'
  ) {
    try {
      const response = await (
        DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }
      ).requestPermission();
      isPermissionGranted = response === 'granted';
      return isPermissionGranted;
    } catch {
      return false;
    }
  }

  isPermissionGranted = true;
  return true;
}
