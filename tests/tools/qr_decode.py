import sys, cv2
img = cv2.imread(sys.argv[1])
img = cv2.copyMakeBorder(img, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=(255, 255, 255))
dets = [cv2.QRCodeDetectorAruco(), cv2.QRCodeDetector()]
text = ''
for fx in (1, 0.5, 2, 0.75):
    im = img if fx == 1 else cv2.resize(img, None, fx=fx, fy=fx, interpolation=cv2.INTER_AREA if fx < 1 else cv2.INTER_NEAREST)
    for d in dets:
        text, _, _ = d.detectAndDecode(im)
        if text: break
    if text: break
sys.stdout.write(text)
