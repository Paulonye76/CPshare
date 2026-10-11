// Camera QR scanner using the browser's BarcodeDetector (Chrome on Android).
// Returns a stop() function. Calls onText for every decoded QR string.
export const scannerSupported = () => 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

export async function requestCameraPermission() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use the camera. Use Chrome on Android over HTTPS.');
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach((t) => t.stop());
  } catch {
    throw new Error('Camera permission is needed to scan the QR code. Allow it in your browser settings and try again.');
  }
}

export async function startScanner(video, onText) {
  const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  await video.play();
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const codes = await detector.detect(video);
      for (const c of codes) if (c.rawValue) onText(c.rawValue);
    } catch { /* frame not ready */ }
    if (!stopped) setTimeout(tick, 150);
  };
  tick();
  return () => { stopped = true; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
}
