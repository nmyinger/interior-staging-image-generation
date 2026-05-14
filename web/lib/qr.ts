import QRCode from "qrcode";

export async function generateQRCodeDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    margin: 2,
    color: { dark: "#292524", light: "#FAFAF9" }, // stone-800 on stone-50
    width: 200,
  });
}

export async function generateQRCodeBuffer(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 400,
  });
}
